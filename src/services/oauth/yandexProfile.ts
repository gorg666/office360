import type { DbAccount } from "@/services/db/accounts";
import { updateAccountProfilePresentation } from "@/services/db/accounts";
import { getContactByEmail, upsertContact, updateContactAvatar } from "@/services/db/contacts";
import { useAccountStore } from "@/stores/accountStore";

/** Размер по умолчанию для публичного URL из документации Yandex ID. */
export const YANDEX_YAPIC_DEFAULT_SIZE = "islands-200" as const;

export interface YandexNormalizedProfile {
  email: string;
  name: string;
  picture?: string;
}

/**
 * Публичный URL аватара по `default_avatar_id` из API Яндекс ID.
 * @see https://yandex.com/dev/id/doc/en/user-information — раздел «Access to profile picture»
 */
export function buildYandexYapicAvatarUrl(
  defaultAvatarId: string,
  size: string = YANDEX_YAPIC_DEFAULT_SIZE,
): string {
  return `https://avatars.yandex.net/get-yapic/${encodeURIComponent(defaultAvatarId)}/${size}`;
}

function parseYandexBooleanFlag(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  return null;
}

/**
 * Разбор ответа https://login.yandex.ru/info?format=json (см. API Яндекс ID).
 * Аватар только из default_avatar_id / avatar_id — не из login (иначе серые заглушки).
 */
export function normalizeYandexUserInfo(data: Record<string, unknown>): YandexNormalizedProfile {
  const email = String(data.default_email ?? data.email ?? "");
  const name = String(data.real_name ?? data.display_name ?? data.login ?? email ?? "");
  const rawId = data.default_avatar_id ?? data.avatar_id;
  const avatarId =
    rawId !== undefined && rawId !== null && String(rawId).trim().length > 0
      ? String(rawId).trim()
      : null;

  const avatarEmpty = parseYandexBooleanFlag(data.is_avatar_empty);
  const picture =
    avatarId && avatarEmpty !== true
      ? buildYandexYapicAvatarUrl(avatarId)
      : undefined;

  return {
    email,
    name,
    picture,
  };
}

export async function fetchYandexLoginProfile(accessToken: string): Promise<YandexNormalizedProfile> {
  const response = await fetch("https://login.yandex.ru/info?format=json", {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Yandex login/info failed: ${response.status} ${body}`);
  }
  const data = (await response.json()) as Record<string, unknown>;
  return normalizeYandexUserInfo(data);
}

/**
 * Публичный get-yapic/<local-part>/ часто отдаёт серую заглушку; в API приходит числовой default_avatar_id.
 */
export function isYandexYapicUrlLoginStubGuess(
  _email: string,
  avatarUrl: string | null | undefined,
): boolean {
  return isYandexYapicUrlUndocumentedNonNumericId(avatarUrl);
}

/**
 * В URL должен быть числовой default_avatar_id; любой нечисловой идентификатор в get-yapic — не по документации.
 */
export function isYandexYapicUrlUndocumentedNonNumericId(avatarUrl: string | null | undefined): boolean {
  if (!avatarUrl?.trim()) return false;
  try {
    const u = new URL(avatarUrl);
    if (u.hostname !== "avatars.yandex.net") return false;
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs[0] !== "get-yapic" || !segs[1]) return false;
    const id = decodeURIComponent(segs[1]);
    return !/^\d+$/.test(id);
  } catch {
    return false;
  }
}

/**
 * Подтягивает аватар (и при необходимости имя) из Яндекс ID для IMAP OAuth-аккаунтов.
 */
export async function refreshYandexImapAccountAvatars(accounts: DbAccount[]): Promise<void> {
  const { ensureFreshToken } = await import("@/services/oauth/oauthTokenManager");

  const targets = accounts.filter(
    (a) =>
      a.provider === "imap" &&
      a.auth_method === "oauth2" &&
      a.oauth_provider === "yandex",
  );

  for (const acc of targets) {
    const needsRefresh =
      !acc.avatar_url?.trim() || isYandexYapicUrlUndocumentedNonNumericId(acc.avatar_url);
    if (!needsRefresh) continue;

    try {
      const token = await ensureFreshToken(acc);
      if (!token.trim()) continue;

      const info = await fetchYandexLoginProfile(token);
      if (!info.picture?.trim()) continue;

      const displayName = info.name?.trim() || null;
      await updateAccountProfilePresentation(acc.id, {
        avatarUrl: info.picture,
        displayName,
      });
      if (displayName) {
        await upsertContact(acc.email, displayName);
      }
      const contactRow = await getContactByEmail(acc.email);
      if (contactRow) {
        await updateContactAvatar(acc.email, info.picture);
      }
      useAccountStore.getState().patchAccount(acc.id, {
        avatarUrl: info.picture,
        ...(displayName ? { displayName } : {}),
      });
    } catch (err) {
      console.warn(`[yandex-profile] Failed to refresh profile for ${acc.email}:`, err);
    }
  }
}
