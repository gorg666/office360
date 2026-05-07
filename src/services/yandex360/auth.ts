import { getAccount } from "../db/accounts";
import { getSecureSetting, setSecureSetting, getSetting, setSetting } from "../db/settings";

const TOKEN_SETTING = "yandex360_access_token";
const CLIENT_ID_SETTING = "yandex360_client_id";
const CLIENT_SECRET_SETTING = "yandex360_client_secret";

export interface Yandex360Credentials {
  clientId: string;
  clientSecret: string;
  accessToken: string;
}

export async function getYandex360AccessToken(accountId?: string): Promise<string> {
  if (accountId) {
    const account = await getAccount(accountId);
    if (!account) {
      throw new Error("Аккаунт Яндекс не найден.");
    }
    if (account.oauth_provider !== "yandex" || !account.access_token) {
      throw new Error("Выбранный аккаунт не подключен через Яндекс ID.");
    }
    return account.access_token;
  }

  const token = await getSecureSetting(TOKEN_SETTING);
  if (!token) {
    throw new Error("Добавьте OAuth-токен Яндекс 360 или выберите подключенный Яндекс ID аккаунт.");
  }
  return token;
}

export async function getYandex360Credentials(): Promise<Yandex360Credentials> {
  const [clientId, clientSecret, accessToken] = await Promise.all([
    getSetting(CLIENT_ID_SETTING),
    getSecureSetting(CLIENT_SECRET_SETTING),
    getSecureSetting(TOKEN_SETTING),
  ]);

  return {
    clientId: clientId ?? "",
    clientSecret: clientSecret ?? "",
    accessToken: accessToken ?? "",
  };
}

export async function saveYandex360Credentials(credentials: {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
}): Promise<void> {
  const writes: Promise<void>[] = [];
  if (credentials.clientId !== undefined) {
    writes.push(setSetting(CLIENT_ID_SETTING, credentials.clientId.trim()));
  }
  if (credentials.clientSecret !== undefined) {
    writes.push(setSecureSetting(CLIENT_SECRET_SETTING, credentials.clientSecret.trim()));
  }
  if (credentials.accessToken !== undefined) {
    writes.push(setSecureSetting(TOKEN_SETTING, credentials.accessToken.trim()));
  }
  await Promise.all(writes);
}
