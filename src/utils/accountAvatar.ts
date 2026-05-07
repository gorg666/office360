const YANDEX_ACCOUNT_DOMAINS = new Set([
  "yandex.ru",
  "ya.ru",
  "yandex.com",
  "yandex.by",
  "yandex.kz",
  "yandex.uz",
  "yandex.ua",
]);

export function getYandexAccountAvatarUrl(email: string | null | undefined): string | null {
  if (!email) return null;

  const [login, domain] = email.trim().toLowerCase().split("@");
  if (!login || !domain || !YANDEX_ACCOUNT_DOMAINS.has(domain)) return null;

  return `https://avatars.yandex.net/get-yapic/${encodeURIComponent(login)}/islands-200`;
}

export function getAccountAvatarUrl(
  email: string | null | undefined,
  savedAvatarUrl: string | null | undefined,
): string | null {
  return savedAvatarUrl ?? getYandexAccountAvatarUrl(email);
}
