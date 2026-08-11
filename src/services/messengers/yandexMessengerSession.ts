import { loadMessengerCredentials } from "./credentials";

export interface YandexMessengerSession {
  token: string;
  manual: true;
}

export function yandexMessengerSourceKey(session: YandexMessengerSession): string {
  return `bot:${session.token.slice(0, 24)}`;
}

/** Bot API accepts the organization bot token issued by Yandex Bot Platform. */
export async function resolveYandexMessengerSession(
  _activeAccountId: string | null,
): Promise<YandexMessengerSession | null> {
  const credentials = loadMessengerCredentials("yandex");
  const token = credentials?.token?.trim();
  return token ? { token, manual: true } : null;
}
