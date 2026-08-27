import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cefCreate, cefInitialize, cefSetBounds, cefSetVisible } from "@/services/cef";
import type { OAuthProviderConfig } from "./providers";
import { beginOAuthUi, endOAuthUi } from "./oauthUiGate";
import { normalizeYandexUserInfo } from "./yandexProfile";
import { normalizeBase64UrlToStandardBase64 } from "@/utils/base64url";

/**
 * CEF profile for Add-Account / screen-code OAuth only.
 * Maps to `account-oauth-add` under telemost-profile — NOT Default.
 * Telemost / existing-account reuse keeps key `"oauth"` → Default.
 * Result binding: OAuth tokens + userInfo flow through startProviderOAuthFlow
 * into account/grant storage (DB + secure settings); the ephemeral CEF profile
 * is never copied into Default and is not a Telemost session source.
 */
export const YANDEX_OAUTH_ADD_CEF_PROFILE = "oauth-add";

async function suspendTelemostCefForAuth(): Promise<void> {
  beginOAuthUi();
  try {
    await cefInitialize();
    await cefSetVisible(false);
  } catch {
    // CEF may be unavailable (non-Windows) — OAuth WebView path still proceeds.
  }
}

/** Shared desktop loopback port for Yandex (Mail + Disk/Tracker) and Gmail-style flows. */
export const OAUTH_CALLBACK_PORT = 17248;
export const YANDEX_DESKTOP_REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}`;
export const YANDEX_VERIFICATION_CODE_REDIRECT_URI = "https://oauth.yandex.ru/verification_code";

export function isYandexVerificationCodeRedirect(redirectUri: string): boolean {
  return (
    redirectUri === YANDEX_VERIFICATION_CODE_REDIRECT_URI
    || redirectUri === "https://oauth.yandex.com/verification_code"
  );
}

/** Map stable Rust OAuth bind errors to user-facing Russian copy (AUTH-005). */
export function formatOAuthCallbackBindError(message: string): string {
  const trimmed = message.trim();
  if (
    /^oauth_callback_port_in_use:\d+$/i.test(trimmed)
    || /Failed to bind OAuth callback on port/i.test(trimmed)
  ) {
    return "Не удалось запустить авторизацию Яндекса: порт 17248 уже занят. Закройте другое окно авторизации Office360 и попробуйте снова.";
  }
  return message;
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
  subjectId?: string;
  login?: string;
  picture?: string;
}

async function openAuthorization(
  provider: OAuthProviderConfig,
  authUrl: string,
  usesCefScreenCode: boolean,
): Promise<() => Promise<void>> {
  if (provider.id !== "yandex") {
    await openUrl(authUrl);
    return async () => {};
  }

  await suspendTelemostCefForAuth();

  if (!usesCefScreenCode) {
    try {
      await invoke("open_oauth_login_window", { url: authUrl });
    } catch (error) {
      endOAuthUi();
      throw error;
    }
    return async () => {
      await invoke("close_oauth_login_window").catch(() => {});
      endOAuthUi();
    };
  }

  try {
    const margin = 32;
    const sidebar = 240;
    await cefSetBounds({
      x: sidebar + margin,
      y: 72,
      width: Math.max(640, window.innerWidth - sidebar - margin * 2),
      height: Math.max(520, window.innerHeight - 104),
      deviceScaleFactor: window.devicePixelRatio || 1,
    });
    // Isolated auth context — do not reuse Default / Telemost session cookies.
    await cefCreate(authUrl, YANDEX_OAUTH_ADD_CEF_PROFILE);
    await cefSetVisible(true);
  } catch (error) {
    try {
      await cefSetVisible(false);
    } catch {
      // ignore
    }
    endOAuthUi();
    throw error;
  }
  return async () => {
    try {
      await cefSetVisible(false);
    } catch {
      // ignore
    }
    endOAuthUi();
  };
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

/**
 * Start the OAuth2 + PKCE flow for a non-Gmail provider.
 * 1. Start localhost callback server (Rust)
 * 2. Open browser to provider consent screen
 * 3. Capture redirect with auth code
 * 4. Exchange code for tokens
 * 5. Fetch user profile info
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

  // Prefer native localhost callback (same as Mail). verification_code is OOB/CEF scrape — not production UX.
  const redirectUri = options?.redirectUri ?? (provider.id === "yandex" ? YANDEX_DESKTOP_REDIRECT_URI : `http://localhost:${OAUTH_CALLBACK_PORT}`);
  const usesCefScreenCode = provider.id === "yandex" && isYandexVerificationCodeRedirect(redirectUri);
  const scopeValue = provider.scopes.join(" ");

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
  let stopWindowListener: (() => void) | null = null;
  let resolveScreenCode: ((result: OAuthServerResult) => void) | null = null;
  const initialAppLocation = window.location.href;
  const callbackPromise = usesCefScreenCode
    ? new Promise<OAuthServerResult>((resolve) => { resolveScreenCode = resolve; })
    : invoke<OAuthServerResult>("start_oauth_server", { port: OAUTH_CALLBACK_PORT, state: oauthState })
      .catch((err: unknown) => {
        const raw = err instanceof Error ? err.message : String(err ?? "");
        throw new Error(formatOAuthCallbackBindError(raw));
      });
  // If the UI cancels via Promise.race, the Rust listener is stopped in finally; silence orphan rejects.
  if (!usesCefScreenCode) {
    void callbackPromise.catch(() => {});
  }
  let rejectWindowClosed: ((reason: Error) => void) | null = null;
  const windowClosedPromise = new Promise<OAuthServerResult>((_, reject) => { rejectWindowClosed = reject; });
  if (provider.id === "yandex" && !usesCefScreenCode) {
    stopWindowListener = await listen("oauth-window-closed", () => {
      rejectWindowClosed?.(new Error("Окно авторизации Яндекс ID закрыто до завершения подключения."));
    });
  }
  const resultPromise = stopWindowListener
    ? Promise.race([callbackPromise, windowClosedPromise])
    : callbackPromise;
  const cancelCefScreenCode = (error: string, error_description: string) => {
    resolveScreenCode?.({ state: oauthState, error, error_description });
  };

  if (usesCefScreenCode) {
    stopCodeListener = await listen<{ type: string; payload: Record<string, unknown> | string }>("cef-event", (event) => {
      const { type, payload } = event.payload;
      if (type === "closed") {
        cancelCefScreenCode("access_denied", "Окно авторизации Яндекс ID закрыто до завершения подключения.");
        return;
      }
      const payloadObject = typeof payload === "string"
        ? (() => { try { return JSON.parse(payload) as Record<string, unknown>; } catch { return {}; } })()
        : (payload ?? {});
      if (type === "oauth-code") {
        const code = typeof payloadObject.code === "string"
          ? payloadObject.code
          : (typeof payloadObject === "object" && payloadObject && "code" in payloadObject ? String((payloadObject as { code?: unknown }).code ?? "") : "");
        if (code) resolveScreenCode?.({ code, state: oauthState });
      }
      if (type === "oauth-error") {
        resolveScreenCode?.({
          state: oauthState,
          error: String(payloadObject.error || "authorization_failed"),
          error_description: String(payloadObject.description || "Авторизация Яндекса завершилась ошибкой."),
        });
      }
    });
  }

  const onEscapeCancel = usesCefScreenCode
    ? (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelCefScreenCode("access_denied", "Авторизация отменена.");
      }
    }
    : null;
  if (onEscapeCancel) window.addEventListener("keydown", onEscapeCancel);

  const routeWatcher = usesCefScreenCode ? window.setInterval(() => {
    if (window.location.href !== initialAppLocation) {
      cancelCefScreenCode("access_denied", "Авторизация отменена при переходе на другую вкладку.");
    }
  }, 250) : null;
  const authorizationTimeout = usesCefScreenCode ? window.setTimeout(() => {
    cancelCefScreenCode("timeout", "Время ожидания авторизации истекло.");
  }, 180_000) : null;

  await new Promise((r) => setTimeout(r, 100));
  const closeAuthorization = await openAuthorization(provider, authUrl, usesCefScreenCode);
  let result: OAuthServerResult;
  try {
    result = await resultPromise;
  } finally {
    if (routeWatcher !== null) window.clearInterval(routeWatcher);
    if (authorizationTimeout !== null) window.clearTimeout(authorizationTimeout);
    if (onEscapeCancel) window.removeEventListener("keydown", onEscapeCancel);
    stopCodeListener?.();
    stopWindowListener?.();
    if (!usesCefScreenCode) {
      await invoke("stop_oauth_server").catch(() => {});
    }
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

  const tokens = await exchangeCode(
    provider,
    result.code,
    clientId,
    usesCefScreenCode ? undefined : redirectUri,
    codeVerifier,
    clientSecret,
  );

  const userInfo = await fetchUserInfo(provider, tokens);

  return { tokens, userInfo };
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
