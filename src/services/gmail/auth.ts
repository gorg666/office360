import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_CALLBACK_PORT = 17248;
const OAUTH_CALLBACK_TIMEOUT_MS = 45_000;
const OAUTH_LISTENING_TIMEOUT_MS = 15_000;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

interface OAuthServerResult {
  code: string;
  state: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface UserInfo {
  email: string;
  name: string;
  picture: string;
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
 * Full OAuth2 + PKCE flow:
 * 1. Start localhost callback server (Rust side)
 * 2. Open browser to Google consent screen
 * 3. Server captures the redirect with auth code
 * 4. Exchange code for tokens
 * 5. Fetch user profile
 */
export async function startOAuthFlow(
  clientId: string,
  clientSecret?: string,
): Promise<{ tokens: TokenResponse; userInfo: UserInfo }> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Generate random state for CSRF protection
  const stateArray = new Uint8Array(32);
  crypto.getRandomValues(stateArray);
  const oauthState = base64UrlEncode(stateArray);

  const redirectUri = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    state: oauthState,
  });

  const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;

  let listeningSettled = false;
  let resolveListening!: () => void;
  let rejectListening!: (err: Error) => void;
  const listeningReady = new Promise<void>((resolve, reject) => {
    resolveListening = resolve;
    rejectListening = reject;
  });
  const listeningTimer = setTimeout(() => {
    if (listeningSettled) return;
    listeningSettled = true;
    rejectListening(
      new Error(
        `OAuth callback listener did not start on port ${OAUTH_CALLBACK_PORT} within ${OAUTH_LISTENING_TIMEOUT_MS}ms.`,
      ),
    );
  }, OAUTH_LISTENING_TIMEOUT_MS);
  const unlistenListening = await listen<{ port: number }>("oauth-listening", (event) => {
    if (listeningSettled) return;
    if (event.payload.port !== OAUTH_CALLBACK_PORT) return;
    listeningSettled = true;
    clearTimeout(listeningTimer);
    resolveListening();
  });

  // Start the server (it blocks until redirect arrives) after the listener event is subscribed.
  const serverPromise = invoke<OAuthServerResult>("start_oauth_server", {
    port: OAUTH_CALLBACK_PORT,
    state: oauthState,
  });
  serverPromise.catch(() => {
    // The race below may time out first; prevent late rejections from bubbling.
  });

  try {
    await listeningReady;
  } finally {
    clearTimeout(listeningTimer);
    unlistenListening();
  }

  await openUrl(authUrl);

  // Wait for the redirect. Google does not redirect back when it blocks an
  // unverified/testing OAuth app, so surface a useful error instead of waiting.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          "OAuth callback timed out. If Google shows access_denied, add this Gmail address to Test users in Google Cloud OAuth consent screen or submit the app for Google verification.",
        ),
      );
    }, OAUTH_CALLBACK_TIMEOUT_MS);
  });
  const result = await Promise.race([serverPromise, timeoutPromise]);
  if (timeoutId) clearTimeout(timeoutId);

  // Validate state parameter (CSRF protection)
  if (result.state !== oauthState) {
    throw new Error("OAuth state mismatch — possible CSRF attack. Please try again.");
  }

  // Exchange auth code for tokens
  const tokens = await exchangeCodeForTokens(
    result.code,
    clientId,
    redirectUri,
    codeVerifier,
    clientSecret,
  );

  // Fetch user info
  const userInfo = await fetchUserInfo(tokens.access_token);

  return { tokens, userInfo };
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
  clientSecret?: string,
): Promise<TokenResponse> {
  const params: Record<string, string> = {
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  };
  if (clientSecret) params.client_secret = clientSecret;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret?: string,
): Promise<TokenResponse> {
  const params: Record<string, string> = {
    refresh_token: refreshToken,
    client_id: clientId,
    grant_type: "refresh_token",
  };
  if (clientSecret) params.client_secret = clientSecret;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  return response.json();
}

async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const response = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!response.ok) {
    throw new Error("Failed to fetch user info");
  }

  return response.json();
}
