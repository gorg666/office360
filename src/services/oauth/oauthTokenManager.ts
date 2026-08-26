import type { DbAccount } from "../db/accounts";
import { updateAccountAllTokens, updateAccountTokens } from "../db/accounts";
import { getOAuthProvider } from "./providers";
import { refreshProviderToken } from "./oauthFlow";
import { computeTokenExpiresAtSeconds } from "./tokenExpiry";
import {
  fingerprintClientId,
  resolveYandexClientSecret,
} from "./yandexOAuthCredentials";

/** Buffer before expiry to trigger a refresh (5 minutes) */
export const OAUTH_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export interface EnsureFreshTokenOptions {
  /** Bypass expiry check and refresh immediately (e.g. after AUTHENTICATIONFAILED). */
  forceRefresh?: boolean;
}

function isInvalidClientRefreshError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("invalid_client") ||
    lower.includes("wrong client secret") ||
    lower.includes("client secret")
  );
}

/**
 * Ensure the account has a fresh OAuth2 access token.
 * If the token is within 5 minutes of expiry (or forceRefresh), refresh and update the DB.
 * Returns the current (or refreshed) access token.
 *
 * Only applies to IMAP accounts with auth_method "oauth2".
 * For Gmail API accounts, token refresh is handled by GmailClient.
 */
export async function ensureFreshToken(
  account: DbAccount,
  options?: EnsureFreshTokenOptions,
): Promise<string> {
  if (account.auth_method !== "oauth2" || !account.oauth_provider) {
    return account.access_token ?? account.imap_password ?? "";
  }

  if (!account.access_token) {
    throw new Error(`OAuth account ${account.email} has no access token`);
  }
  if (!account.refresh_token) {
    throw new Error(`OAuth account ${account.email} has no refresh token`);
  }

  const now = Date.now();
  const expiresAt = (account.token_expires_at ?? 0) * 1000; // DB stores seconds
  const forceRefresh = options?.forceRefresh === true;

  if (!forceRefresh && expiresAt - now > OAUTH_TOKEN_REFRESH_BUFFER_MS) {
    return account.access_token;
  }

  console.warn("[reconnect-diagnostic]", {
    ts: new Date().toISOString(),
    origin: "ensureFreshToken.refresh_start",
    accountId: account.id,
    email: account.email,
    provider: account.oauth_provider,
    expiresAt,
    now,
    forceRefresh,
    clientIdFingerprint: fingerprintClientId(account.oauth_client_id),
    refreshTokenPresent: Boolean(account.refresh_token),
    reason: forceRefresh ? "force_refresh" : "token_expired_or_expiring",
  });

  const provider = getOAuthProvider(account.oauth_provider);
  if (!provider) {
    throw new Error(`Unknown OAuth provider: ${account.oauth_provider}`);
  }

  if (!account.oauth_client_id) {
    throw new Error(`OAuth account ${account.email} has no client ID`);
  }

  let clientSecret = account.oauth_client_secret ?? undefined;
  if (account.oauth_provider === "yandex") {
    clientSecret = await resolveYandexClientSecret(account.oauth_client_secret);
    console.info("[oauth][yandex] refresh credentials:", {
      clientIdFingerprint: fingerprintClientId(account.oauth_client_id),
      clientSecretPresent: Boolean(clientSecret),
      refreshTokenPresent: true,
    });
  }

  let tokens;
  try {
    tokens = await refreshProviderToken(
      provider,
      account.refresh_token,
      account.oauth_client_id,
      clientSecret,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[oauth] refresh failed:", {
      provider: account.oauth_provider,
      clientIdFingerprint: fingerprintClientId(account.oauth_client_id),
      clientSecretPresent: Boolean(clientSecret),
      invalidClient: isInvalidClientRefreshError(message),
    });
    if (
      account.oauth_provider === "yandex" &&
      isInvalidClientRefreshError(message)
    ) {
      throw new Error(
        "Сессия Яндекс ID не обновляется: для этого OAuth-приложения нужен client secret. " +
          "Добавьте секрет Яндекс OAuth в настройках (безопасное хранилище) и подключите аккаунт снова.",
      );
    }
    if (
      /invalid_grant|expired|revoked|invalid.*token/i.test(message)
    ) {
      throw new Error(
        "Сессия Яндекс ID истекла. Подключите аккаунт повторно.",
      );
    }
    throw err;
  }

  const newExpiresAt = computeTokenExpiresAtSeconds(tokens.expires_in);
  const newRefresh = tokens.refresh_token?.trim();

  if (newRefresh) {
    await updateAccountAllTokens(
      account.id,
      tokens.access_token,
      newRefresh,
      newExpiresAt,
    );
    account.refresh_token = newRefresh;
  } else {
    await updateAccountTokens(account.id, tokens.access_token, newExpiresAt);
  }

  console.warn("[reconnect-diagnostic]", {
    ts: new Date().toISOString(),
    origin: "ensureFreshToken.refresh_success",
    accountId: account.id,
    email: account.email,
    provider: account.oauth_provider,
    newExpiresAt,
    refreshTokenRotated: Boolean(newRefresh),
  });

  account.access_token = tokens.access_token;
  account.token_expires_at = newExpiresAt;
  return tokens.access_token;
}
