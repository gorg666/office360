import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { OAuthProviderConfig } from "./providers";
import { getYandexOAuthConfigDiagnostics } from "./providers";
import { normalizeBase64UrlToStandardBase64 } from "@/utils/base64url";

const OAUTH_CALLBACK_PORT = 17248;

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
  options?: { loginHint?: string },
): Promise<{ tokens: TokenResponse; userInfo: ProviderUserInfo }> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const stateArray = new Uint8Array(32);
  crypto.getRandomValues(stateArray);
  const oauthState = base64UrlEncode(stateArray);

  const redirectUri = `http://localhost:${OAUTH_CALLBACK_PORT}`;
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
    if (options?.loginHint) {
      params.login_hint = options.loginHint;
    }
    const yandexDiagnostics = getYandexOAuthConfigDiagnostics();
    console.info("[oauth][yandex] client_id (effective):", clientId);
    console.info("[oauth][yandex] client_id source:", yandexDiagnostics.clientIdSource);
    console.info("[oauth][yandex] env client_id:", yandexDiagnostics.envClientId ?? "<empty>");
    console.info("[oauth][yandex] fallback client_id:", yandexDiagnostics.fallbackClientId);
    console.info("[oauth] Yandex OAuth scopes:", provider.scopes);
    console.info("[oauth] Yandex OAuth scope string:", "omitted");
    console.info("[oauth] Yandex redirect URI:", redirectUri);
  } else {
    params.scope = scopeValue;
  }

  const authUrl = `${provider.authUrl}?${new URLSearchParams(params).toString()}`;
  if (provider.id === "yandex") {
    const sentScope = new URL(authUrl).searchParams.get("scope");
    console.info("[oauth] Yandex authorize URL scope query:", sentScope ?? "omitted");
    console.info("[oauth][yandex] scope: omitted");
    console.info("[oauth][yandex] authorize URL:", authUrl);
  }

  const serverPromise = invoke<OAuthServerResult>("start_oauth_server", {
    port: OAUTH_CALLBACK_PORT,
    state: oauthState,
  });

  await new Promise((r) => setTimeout(r, 100));
  await openUrl(authUrl);

  const result = await serverPromise;

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
    redirectUri,
    codeVerifier,
    clientSecret,
  );
  if (provider.id === "yandex") {
    console.info("[oauth][yandex] token response scope:", tokens.scope ?? "<empty>");
  }

  const userInfo = await fetchUserInfo(provider, tokens);

  return { tokens, userInfo };
}

async function exchangeCode(
  provider: OAuthProviderConfig,
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
  clientSecret?: string,
): Promise<TokenResponse> {
  // Use Rust backend for token exchange to avoid CORS issues (required for Microsoft native client)
  return invoke<TokenResponse>("oauth_exchange_token", {
    tokenUrl: provider.tokenUrl,
    code,
    clientId,
    redirectUri,
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
    const email = data.default_email || data.email || "";
    const name = data.real_name || data.display_name || data.login || email;
    return {
      email,
      name,
      picture: data.default_avatar_id
        ? `https://avatars.yandex.net/get-yapic/${data.default_avatar_id}/islands-200`
        : undefined,
    };
  }

  return {
    email: data.email || "",
    name: data.name || "",
    picture: data.picture || undefined,
  };
}
