import { getAllAccounts } from "@/services/db/accounts";
import { getYandexGrantAccessToken } from "@/services/oauth/yandexUnifiedAuth";
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
 * Токен Мессенджера берётся из grant «Коммуникации» активного Яндекс ID.
 * Ручной bot token остаётся резервом для аккаунтов без пользовательского grant.
 */
export async function resolveYandexMessengerSession(
  activeAccountId: string | null,
): Promise<YandexMessengerSession | null> {
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

  if (!picked) {
    const manual = loadMessengerCredentials("yandex");
    return manual?.token?.trim() ? { token: manual.token.trim(), manual: true } : null;
  }

  let token = "";
  try {
    token = (await getYandexGrantAccessToken(picked.id, "communications")).trim();
  } catch {
    const manual = loadMessengerCredentials("yandex");
    return manual?.token?.trim() ? { token: manual.token.trim(), manual: true } : null;
  }
  if (!token) return null;

  return {
    token,
    manual: false,
    accountId: picked.id,
    accountEmail: picked.email,
  };
}
