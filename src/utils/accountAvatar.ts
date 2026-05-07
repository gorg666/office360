const YANDEX_ACCOUNT_DOMAINS = new Set([
  "yandex.ru",
  "ya.ru",
  "yandex.com",
  "yandex.by",
  "yandex.kz",
  "yandex.uz",
  "yandex.ua",
]);

function isGuessedYandexAvatarUrl(
  email: string | null | undefined,
  avatarUrl: string,
): boolean {
  if (!email) return false;

  const [login, domain] = email.trim().toLowerCase().split("@");
  if (!login || !domain || !YANDEX_ACCOUNT_DOMAINS.has(domain)) return false;

  try {
    const url = new URL(avatarUrl);
    if (url.hostname !== "avatars.yandex.net") return false;
    const [, service, avatarId] = url.pathname.split("/");
    return service === "get-yapic" && avatarId?.toLowerCase() === login;
  } catch {
    return false;
  }
}

export function getAccountAvatarUrl(
  email: string | null | undefined,
  savedAvatarUrl: string | null | undefined,
): string | null {
  if (savedAvatarUrl && isGuessedYandexAvatarUrl(email, savedAvatarUrl)) {
    return null;
  }

  return savedAvatarUrl ?? null;
}
