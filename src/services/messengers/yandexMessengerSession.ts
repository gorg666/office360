import { getAllAccounts } from "@/services/db/accounts";
import { ensureFreshToken } from "@/services/oauth/oauthTokenManager";
import { loadMessengerCredentials } from "./credentials";

export interface YandexMessengerSession {
  token: string;
  manual: boolean;
  accountId?: string;
  accountEmail?: string;
}

export function yandexMessengerSourceKey(session: YandexMessengerSession): string {
  if (session.manual) return `manual:${session.token.slice(0, 24)}`;
  return `account:${session.accountId ?? "unknown"}`;
}

/**
 * Токен для Bot API: сначала ручной токен из настроек мессенджера, иначе OAuth-токен
 * аккаунта Яндекс Почты (тот же, что для IMAP), с автообновлением по refresh_token.
 */
export async function resolveYandexMessengerSession(
  activeAccountId: string | null,
): Promise<YandexMessengerSession | null> {
  const manual = loadMessengerCredentials("yandex");
  if (manual?.token?.trim()) {
    return { token: manual.token.trim(), manual: true };
  }

  const accounts = await getAllAccounts();
  const yandexOAuth = accounts.filter(
    (a) =>
      a.provider === "imap" &&
      a.auth_method === "oauth2" &&
      a.oauth_provider === "yandex" &&
      Boolean(a.access_token?.trim()),
  );

  const picked =
    (activeAccountId ? yandexOAuth.find((a) => a.id === activeAccountId) : undefined) ??
    yandexOAuth[0];

  if (!picked) return null;

  const token = (await ensureFreshToken(picked)).trim();
  if (!token) return null;

  return {
    token,
    manual: false,
    accountId: picked.id,
    accountEmail: picked.email,
  };
}
