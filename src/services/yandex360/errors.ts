import type { Yandex360ApiErrorDetails } from "./types";

export class Yandex360ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;

  constructor(details: Yandex360ApiErrorDetails) {
    super(formatYandex360Error(details));
    this.name = "Yandex360ApiError";
    this.status = details.status;
    this.statusText = details.statusText;
    this.body = details.body;
  }
}

function formatYandex360Error(details: Yandex360ApiErrorDetails): string {
  if (details.status === 401) {
    return "Яндекс 360 отклонил токен. Авторизуйте аккаунт заново или проверьте OAuth scopes.";
  }
  if (details.status === 403) {
    return "Недостаточно прав для операции Яндекс 360. Проверьте scopes приложения, роль администратора и тариф организации.";
  }
  if (details.status === 404) {
    return "Ресурс Яндекс 360 не найден. Проверьте orgId, домен или идентификатор объекта.";
  }
  if (details.status === 429) {
    return "Яндекс 360 ограничил частоту запросов. Повторите позже.";
  }
  return `Ошибка Яндекс 360 ${details.status} ${details.statusText}: ${details.body}`;
}
