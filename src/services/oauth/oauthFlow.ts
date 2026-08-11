import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cefCreate, cefInitialize, cefSetBounds, cefSetVisible } from "@/services/cef";
import type { OAuthProviderConfig } from "./providers";
import { normalizeYandexUserInfo } from "./yandexProfile";
import { normalizeBase64UrlToStandardBase64 } from "@/utils/base64url";

const OAUTH_CALLBACK_PORT = 17248;
const OAUTH_LISTENING_TIMEOUT_MS = 15_000;
const OAUTH_CALLBACK_TIMEOUT_MS = 300_000;

interface OAuthListeningInfo {
  port: number;
  ipv4: boolean;
  ipv6: boolean;
}

export interface StartProviderOAuthOptions {
  /**
   * Optional Yandex `login_hint`.
   * Pass ONLY a confirmed existing account identifier (e.g. re-auth of a saved account).
   * Do NOT pass a free-typed email from the connect form — Yandex returns
   * `invalid_request` for nonexistent accounts ("Запрашивается авторизация несуществующим аккаунтом").
   */
  loginHint?: string;
  /** Must be true together with loginHint for the hint to be sent. */
  confirmedAccount?: boolean;
}

/**
 * Register for `oauth-listening` and return a waiter.
 * Caller must `await` this BEFORE `invoke("start_oauth_server")` so the event cannot be missed.
 */
async function createOAuthListeningWaiter(expectedPort: number): Promise<{
  ready: Promise<OAuthListeningInfo>;
  cancel: () => void;
}> {
  let settled = false;
  let resolveReady!: (info: OAuthListeningInfo) => void;
  let rejectReady!: (err: Error) => void;
  const ready = new Promise<OAuthListeningInfo>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectReady(
      new Error(
        `OAuth callback listener did not start on port ${expectedPort} within ${OAUTH_LISTENING_TIMEOUT_MS}ms.`,
      ),
    );
  }, OAUTH_LISTENING_TIMEOUT_MS);

  const unlisten = await listen<OAuthListeningInfo>("oauth-listening", (event) => {
    if (settled) return;
    if (event.payload.port !== expectedPort) {
      console.warn(
        "[oauth] ignoring listening event for unexpected port",
        event.payload.port,
      );
      return;
    }
    settled = true;
    clearTimeout(timer);
    resolveReady(event.payload);
  });

  return {
    ready,
    cancel: () => {
      clearTimeout(timer);
      unlisten();
    },
  };
}

interface OAuthServerResult {
  code?: string;
  state: string;
  error?: string;
  error_description?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  id_token?: string;
}

export interface ProviderUserInfo {
  email: string;
  name: string;
  picture?: string;
}

async function openAuthorization(provider: OAuthProviderConfig, authUrl: string): Promise<() => Promise<void>> {
  if (provider.id !== "yandex") {
    await openUrl(authUrl);
    return async () => {};
  }

  await cefInitialize();
  const margin = 32;
  const sidebar = 240;
  await cefSetBounds({
    x: sidebar + margin,
    y: 72,
    width: Math.max(640, window.innerWidth - sidebar - margin * 2),
    height: Math.max(520, window.innerHeight - 104),
    deviceScaleFactor: window.devicePixelRatio || 1,
  });
  await cefCreate(authUrl);
  await cefSetVisible(true);
  return async () => { await cefSetVisible(false); };
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function userFacingOAuthError(providerId: string, code?: string): string {
  if (providerId === "yandex") {
    switch (code) {
      case "access_denied":
        return "Вход через Яндекс ID отменён.";
      case "invalid_request":
        return "Не удалось войти через Яндекс ID. Попробуйте снова или выберите другой аккаунт.";
      case "cancelled":
        return "Вход через Яндекс ID отменён.";
      default:
        return "Не удалось войти через Яндекс ID. Попробуйте снова или выберите другой аккаунт.";
    }
  }
  return "OAuth authorization failed. Please try again.";
}

async function signalOAuthCancel(oauthState: string): Promise<void> {
  const qs = new URLSearchParams({
    error: "access_denied",
    error_description: "cancelled",
    state: oauthState,
  });
  try {
    await fetch(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}/?${qs.toString()}`, {
      method: "GET",
      cache: "no-store",
      mode: "no-cors",
    });
  } catch {
    // Best-effort wake-up of the Rust accept loop.
  }
}

async function closeYandexOAuthWindow(): Promise<void> {
  try {
    await invoke("close_oauth_login_window");
  } catch (err) {
    console.warn("[oauth][yandex] failed to close OAuth window:", err);
  }
}

/**
 * Start the OAuth2 + PKCE flow for a non-Gmail provider.
 * Yandex: in-app WebView (`yandex-oauth`) + localhost:17248 callback.
 * Other providers: system browser via opener (unchanged).
 */
export async function startProviderOAuthFlow(
  provider: OAuthProviderConfig,
  clientId: string,
  clientSecret?: string,
  options?: { loginHint?: string; scopes?: string[]; redirectUri?: string },
): Promise<{ tokens: TokenResponse; userInfo: ProviderUserInfo }> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const stateArray = new Uint8Array(32);
  crypto.getRandomValues(stateArray);
  const oauthState = base64UrlEncode(stateArray);

  const redirectUri = options?.redirectUri ?? `http://localhost:${OAUTH_CALLBACK_PORT}`;
  const usesCefScreenCode = provider.id === "yandex" && redirectUri === "https://oauth.yandex.ru/verification_code";
  const scopeValue = provider.scopes.join(" ");
  const useEmbeddedYandex = provider.id === "yandex";

  const params: Record<string, string> = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state: oauthState,
  };

  if (provider.usePkce) {
    params.code_challenge = codeChallenge;
    params.code_challenge_method = "S256";
  }

  // Provider-specific auth params
  if (provider.id === "microsoft") {
    params.prompt = "consent";
    params.response_mode = "query";
  }
  if (provider.id === "yandex") {
    params.force_confirm = "yes";
    if (options?.scopes?.length) params.scope = options.scopes.join(" ");
    if (options?.loginHint) {
      params.login_hint = options.loginHint;
    }
  } else {
    params.scope = scopeValue;
  }

  const authUrl = `${provider.authUrl}?${new URLSearchParams(params).toString()}`;

  let stopCodeListener: (() => void) | null = null;
  let resolveScreenCode: ((result: OAuthServerResult) => void) | null = null;
  const initialAppLocation = window.location.href;
  const resultPromise = usesCefScreenCode
    ? new Promise<OAuthServerResult>((resolve) => { resolveScreenCode = resolve; })
    : invoke<OAuthServerResult>("start_oauth_server", { port: OAUTH_CALLBACK_PORT, state: oauthState });
  if (usesCefScreenCode) {
    stopCodeListener = await listen<{ type: string; payload: Record<string, unknown> }>("cef-event", (event) => {
      if (event.payload.type === "oauth-code") {
        const code = event.payload.payload.code;
        if (typeof code === "string" && code) resolveScreenCode?.({ code, state: oauthState });
      }
      if (event.payload.type === "oauth-error") {
        resolveScreenCode?.({
          state: oauthState,
          error: String(event.payload.payload.error || "authorization_failed"),
          error_description: String(event.payload.payload.description || "Авторизация Яндекса завершилась ошибкой."),
        });
      }
    });
  }

  const routeWatcher = usesCefScreenCode ? window.setInterval(() => {
    if (window.location.href !== initialAppLocation) {
      resolveScreenCode?.({ state: oauthState, error: "access_denied", error_description: "Авторизация отменена при переходе на другую вкладку." });
    }
  }, 250) : null;
  const authorizationTimeout = usesCefScreenCode ? window.setTimeout(() => {
    resolveScreenCode?.({ state: oauthState, error: "timeout", error_description: "Время ожидания авторизации истекло." });
  }, 180_000) : null;

  await new Promise((r) => setTimeout(r, 100));
  const closeAuthorization = await openAuthorization(provider, authUrl);
  let result: OAuthServerResult;
  try {
    result = await resultPromise;
  } finally {
    if (routeWatcher !== null) window.clearInterval(routeWatcher);
    if (authorizationTimeout !== null) window.clearTimeout(authorizationTimeout);
    stopCodeListener?.();
    await closeAuthorization();
  }

  if (result.state !== oauthState) {
    throw new Error("OAuth state mismatch — possible CSRF attack. Please try again.");
  }
  if (result.error) {
    const description = result.error_description?.trim();
    if (provider.id === "yandex") {
      const requestedScopes = provider.scopes.join(" ");
      throw new Error(
        description
          ? `Yandex OAuth error: ${result.error} (${description}) | requested_scopes="${requestedScopes}" | client_id="${clientId}" | redirect_uri="${redirectUri}"`
          : `Yandex OAuth error: ${result.error} | requested_scopes="${requestedScopes}" | client_id="${clientId}" | redirect_uri="${redirectUri}"`,
      );
    }
    throw new Error(
      description
        ? `Yandex OAuth error: ${result.error} (${description})`
        : `Yandex OAuth error: ${result.error}`,
    );
  }
  if (!result.code) {
    throw new Error("OAuth callback missing authorization code.");
  }
  listeningWaiter.cancel();

  const tokens = await exchangeCode(
    provider,
    result.code,
    clientId,
    usesCefScreenCode ? undefined : redirectUri,
    codeVerifier,
    clientSecret,
  );

  let windowClosedUnlisten: (() => void) | undefined;
  let cancelledByUser = false;
  let flowFinished = false;
  const cancelPromise = useEmbeddedYandex
    ? new Promise<never>((_, reject) => {
        void listen("oauth-window-closed", () => {
          if (flowFinished) return;
          cancelledByUser = true;
          void signalOAuthCancel(oauthState);
          reject(new Error(userFacingOAuthError("yandex", "cancelled")));
        }).then((fn) => {
          windowClosedUnlisten = fn;
        });
      })
    : null;

  try {
    if (useEmbeddedYandex) {
      await invoke("open_oauth_login_window", { url: authUrl });
      console.info("[oauth][yandex] embedded OAuth window opened");
    } else {
      await openUrl(authUrl);
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            useEmbeddedYandex
              ? "Время ожидания входа через Яндекс ID истекло. Попробуйте снова."
              : "OAuth callback timed out. Please try again.",
          ),
        );
      }, OAUTH_CALLBACK_TIMEOUT_MS);
    });

    const races: Array<Promise<OAuthServerResult>> = [serverPromise, timeoutPromise];
    if (cancelPromise) races.push(cancelPromise);

    let result: OAuthServerResult;
    try {
      result = await Promise.race(races);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    if (result.state !== oauthState) {
      throw new Error("OAuth state mismatch — possible CSRF attack. Please try again.");
    }
    if (result.error) {
      const description = result.error_description?.trim();
      console.warn(
        "[oauth] provider error:",
        result.error,
        description ? "(description present)" : "(no description)",
      );
      if (result.error === "access_denied" && description === "cancelled") {
        throw new Error(userFacingOAuthError(provider.id, "cancelled"));
      }
      throw new Error(userFacingOAuthError(provider.id, result.error));
    }
    if (!result.code) {
      throw new Error(userFacingOAuthError(provider.id));
    }

    // Close WebView as soon as we have the authorization code so the user is
    // not left on a blank localhost page during token exchange / userInfo.
    if (useEmbeddedYandex) {
      await closeYandexOAuthWindow();
    }

    const tokens = await exchangeCode(
      provider,
      result.code,
      clientId,
      redirectUri,
      codeVerifier,
      clientSecret,
    );
    if (provider.id === "yandex") {
      console.info("[oauth][yandex] token response scope:", tokens.scope ?? "<empty>");
    }

    const userInfo = await fetchUserInfo(provider, tokens);
    flowFinished = true;
    return { tokens, userInfo };
  } catch (err) {
    flowFinished = true;
    if (useEmbeddedYandex && !cancelledByUser) {
      await signalOAuthCancel(oauthState);
    }
    throw err;
  } finally {
    flowFinished = true;
    windowClosedUnlisten?.();
    windowClosedUnlisten = undefined;
    if (useEmbeddedYandex) {
      await closeYandexOAuthWindow();
    }
  }
}

async function exchangeCode(
  provider: OAuthProviderConfig,
  code: string,
  clientId: string,
  redirectUri: string | undefined,
  codeVerifier: string,
  clientSecret?: string,
): Promise<TokenResponse> {
  // Use Rust backend for token exchange to avoid CORS issues (required for Microsoft native client)
  return invoke<TokenResponse>("oauth_exchange_token", {
    tokenUrl: provider.tokenUrl,
    code,
    clientId,
    redirectUri: redirectUri ?? null,
    codeVerifier: provider.usePkce ? codeVerifier : null,
    clientSecret: clientSecret || null,
    scope: provider.id === "microsoft" ? provider.scopes.join(" ") : null,
  });
}

/**
 * Refresh an expired access token for a non-Gmail provider.
 */
export async function refreshProviderToken(
  provider: OAuthProviderConfig,
  refreshToken: string,
  clientId: string,
  clientSecret?: string,
): Promise<TokenResponse> {
  // Use Rust backend for token refresh to avoid CORS issues
  return invoke<TokenResponse>("oauth_refresh_token", {
    tokenUrl: provider.tokenUrl,
    refreshToken,
    clientId,
    clientSecret: clientSecret || null,
    scope: provider.id === "microsoft" ? provider.scopes.join(" ") : null,
  });
}

function parseIdToken(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("Invalid ID token format");
  const decoded = atob(normalizeBase64UrlToStandardBase64(payload));
  return JSON.parse(decoded);
}

async function fetchUserInfo(
  provider: OAuthProviderConfig,
  tokens: TokenResponse,
): Promise<ProviderUserInfo> {
  // Microsoft: extract user info from ID token (can't use Graph API with Outlook scopes)
  if (provider.id === "microsoft") {
    if (tokens.id_token) {
      const claims = parseIdToken(tokens.id_token);
      return {
        email: (claims.email as string) || (claims.preferred_username as string) || "",
        name: (claims.name as string) || "",
        picture: undefined,
      };
    }
    // Fallback if no ID token
    return { email: "", name: "", picture: undefined };
  }

  if (!provider.userInfoUrl) {
    throw new Error(`Provider ${provider.id} has no user info endpoint`);
  }

  const authScheme = provider.userInfoAuthScheme ?? "Bearer";
  const response = await fetch(provider.userInfoUrl, {
    headers: { Authorization: `${authScheme} ${tokens.access_token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${await response.text()}`);
  }

  const data = await response.json();

  // Normalize response across providers
  if (provider.id === "yahoo") {
    return {
      email: data.email || "",
      name: data.name || data.nickname || "",
      picture: data.picture || undefined,
    };
  }

  if (provider.id === "yandex") {
    return normalizeYandexUserInfo(data as Record<string, unknown>);
  }

  return {
    email: data.email || "",
    name: data.name || "",
    picture: data.picture || undefined,
  };
}
