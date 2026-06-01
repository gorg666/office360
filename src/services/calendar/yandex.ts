import type { DbAccount } from "@/services/db/accounts";

export const YANDEX_CALDAV_URL = "https://caldav.yandex.ru/";
export const YANDEX_CALENDAR_SCOPE = "calendar:all";

export function isYandexOAuthCalendarAccount(account: DbAccount): boolean {
  return (
    account.provider === "imap" &&
    account.auth_method === "oauth2" &&
    account.oauth_provider === "yandex" &&
    account.calendar_provider !== ""
  );
}
