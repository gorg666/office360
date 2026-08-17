import { invoke } from "@tauri-apps/api/core";
import { getAccountByEmail } from "@/services/db/accounts";
import { getDesktopPlatform } from "@/utils/desktopPlatform";
import { normalizeEmail } from "@/utils/emailUtils";

export function requireYandexWkAccountKey(accountKey?: string | null): string {
  const key = accountKey?.trim() ?? "";
  if (!key) {
    throw new Error("Yandex login requires an account session key.");
  }
  return key;
}

export async function resolveYandexWkAccountKey(email: string): Promise<{
  accountKey: string;
  provisional: boolean;
}> {
  const existing = await getAccountByEmail(email.trim());
  if (existing?.id) {
    return { accountKey: existing.id, provisional: false };
  }
  return { accountKey: crypto.randomUUID(), provisional: true };
}

export function yandexIdentityMismatchMessage(expectedEmail: string, actualEmail: string): string {
  return `В Яндекс ID выбран другой аккаунт (${actualEmail}). Ожидался ${expectedEmail}. Выберите нужный аккаунт и повторите вход.`;
}

export function assertYandexOAuthMatchesAccount(
  expectedEmail: string | null | undefined,
  oauthEmail: string,
): void {
  if (!expectedEmail?.includes("@") || !oauthEmail.includes("@")) return;
  if (normalizeEmail(expectedEmail) !== normalizeEmail(oauthEmail)) {
    throw new Error(yandexIdentityMismatchMessage(expectedEmail, oauthEmail));
  }
}

export async function cleanupProvisionalYandexWkStore(
  accountKey: string,
  provisional: boolean,
): Promise<void> {
  if (!provisional) return;
  const key = accountKey.trim();
  if (!key) return;
  try {
    if ((await getDesktopPlatform()) !== "macos") return;
    await invoke("reset_telemost_macos_profile", { accountKey: key });
  } catch (error) {
    console.warn("[yandex-auth] provisional WK store cleanup failed", error);
  }
}

export const YANDEX_PASSPORT_BOOTSTRAP_URL =
  "https://passport.yandex.ru/auth?origin=office360&retpath=https%3A%2F%2Fid.yandex.ru";

export async function bootstrapYandexPassportSession(accountId: string): Promise<void> {
  const accountKey = requireYandexWkAccountKey(accountId);
  await invoke("open_oauth_login_window", {
    url: YANDEX_PASSPORT_BOOTSTRAP_URL,
    accountKey,
    purpose: "passport-bootstrap",
  });
}
