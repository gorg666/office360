import { getSecureSetting, setSecureSetting } from "@/services/db/settings";

/** Encrypted settings key — never log the value. */
export const YANDEX_OAUTH_CLIENT_SECRET_SETTING = "yandex_oauth_client_secret";

/**
 * Resolve Yandex OAuth client_secret for token refresh.
 *
 * Yandex PKCE code exchange can omit the secret; refresh for apps that have a
 * password configured still requires the correct secret (otherwise
 * `invalid_client` / Wrong client secret).
 *
 * Sources (first wins):
 * 1. Per-account `oauth_client_secret` (already decrypted by accounts layer)
 * 2. Secure settings store (OS-backed encryption via app crypto)
 *
 * Never read secrets from `VITE_*` env (would ship in the frontend bundle).
 */
export async function resolveYandexClientSecret(
  accountSecret?: string | null,
): Promise<string | undefined> {
  const fromAccount = accountSecret?.trim();
  if (fromAccount) return fromAccount;

  const fromSecure = (await getSecureSetting(YANDEX_OAUTH_CLIENT_SECRET_SETTING))?.trim();
  if (fromSecure) return fromSecure;

  return undefined;
}

export async function saveYandexClientSecret(secret: string): Promise<void> {
  const trimmed = secret.trim();
  if (!trimmed) return;
  await setSecureSetting(YANDEX_OAUTH_CLIENT_SECRET_SETTING, trimmed);
}

export function fingerprintClientId(clientId: string | null | undefined): string {
  const id = (clientId ?? "").trim();
  if (!id) return "<empty>";
  if (id.length <= 4) return `len=${id.length}`;
  return `…${id.slice(-4)} (len=${id.length})`;
}
