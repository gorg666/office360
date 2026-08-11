import { getYandexGrantAccessToken } from "@/services/oauth/yandexUnifiedAuth";

export async function getYandex360AccessToken(accountId?: string): Promise<string> {
  if (!accountId) {
    throw new Error("Выберите Яндекс-аккаунт для административной операции.");
  }
  return getYandexGrantAccessToken(accountId, "admin");
}
