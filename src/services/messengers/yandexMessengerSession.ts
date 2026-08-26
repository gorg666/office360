import { loadMessengerCredentials } from "./credentials";

export interface YandexMessengerSession {
  token: string;
  /** Always true: Bot API accepts only organization bot tokens, never user OAuth. */
  manual: true;
}

export function yandexMessengerSourceKey(session: YandexMessengerSession): string {
  return `bot:${session.token.slice(0, 24)}`;
}

/**
 * Bot API session for org bots only.
 * User Yandex ID OAuth tokens must never be sent to Bot API — user chats go through the Messenger widget.
 */
export async function resolveYandexMessengerSession(
  _activeAccountId: string | null,
): Promise<YandexMessengerSession | null> {
  const credentials = loadMessengerCredentials("yandex");
  const token = credentials?.token?.trim();
  return token ? { token, manual: true } : null;
}
