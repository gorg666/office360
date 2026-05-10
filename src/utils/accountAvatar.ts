/**
 * Публичный URL аватара Яндекс ID строится только из `default_avatar_id`, который
 * возвращает https://login.yandex.ru/info при праве `login:avatar`.
 * Подставлять логин из email в `get-yapic/...` нельзя — сервер отдаёт серую заглушку.
 * @see https://yandex.com/dev/id/doc/en/user-information
 */
export function getYandexPasportAvatarUrlFromEmail(
  _email: string | null | undefined,
): string | null {
  return null;
}
