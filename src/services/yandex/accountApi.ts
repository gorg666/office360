import { getAccount, getAllAccounts, updateAccountAllTokens, type DbAccount } from "@/services/db/accounts";
import { ensureFreshToken } from "@/services/oauth/oauthTokenManager";
import { getSecureSetting, getSetting, setSecureSetting, setSetting } from "@/services/db/settings";
import { getOAuthProvider } from "@/services/oauth/providers";
import { refreshProviderToken, startProviderOAuthFlow } from "@/services/oauth/oauthFlow";
import { normalizeEmail } from "@/utils/emailUtils";
import { getCurrentUnixTimestamp } from "@/utils/timestamp";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export class YandexApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = "YandexApiError";
  }
}

export const YANDEX_SERVICE_SCOPES = [
  "cloud_api:disk.read",
  "cloud_api:disk.write",
  "tracker:read",
  "tracker:write",
];

export const DEFAULT_YANDEX_SERVICE_CLIENT_ID = "69e59ec6dcfe4be3a085006d49678056";

const serviceKey = (accountId: string, name: string) => `yandex_services_${name}:${accountId}`;

export async function resolveYandexAccount(preferredId?: string | null): Promise<DbAccount> {
  if (preferredId) {
    const account = await getAccount(preferredId);
    if (account?.oauth_provider === "yandex" && account.auth_method === "oauth2") return account;
  }
  const accounts = await getAllAccounts();
  const account = accounts.find((item) => item.oauth_provider === "yandex" && item.auth_method === "oauth2");
  if (!account) throw new Error("Подключите Яндекс-аккаунт через OAuth.");
  return account;
}

export async function getYandexContext(preferredId?: string | null) {
  const account = await resolveYandexAccount(preferredId);
  const token = await ensureFreshToken(account);
  if (!token) throw new Error("OAuth-токен Яндекса отсутствует. Переподключите аккаунт.");
  return { account, token };
}

export async function getYandexServiceClientId(accountId: string): Promise<string | null> {
  return (await getSetting(serviceKey(accountId, "client_id"))) || DEFAULT_YANDEX_SERVICE_CLIENT_ID;
}

export async function authorizeYandexServices(accountId: string, clientId: string): Promise<void> {
  const account = await resolveYandexAccount(accountId);
  const provider = getOAuthProvider("yandex");
  if (!provider) throw new Error("Конфигурация Yandex OAuth не найдена.");
  const normalizedClientId = clientId.trim();
  if (!normalizedClientId) throw new Error("Укажите Client ID API-приложения Яндекса.");

  const infoResponse = await tauriFetch(`https://oauth.yandex.ru/client/${encodeURIComponent(normalizedClientId)}/info`);
  if (!infoResponse.ok) throw new Error("Не удалось проверить Yandex OAuth Client ID.");
  const info = await infoResponse.json() as { scope?: string[] };
  const allowed = new Set(info.scope ?? []);
  const missing = YANDEX_SERVICE_SCOPES.filter((scope) => !allowed.has(scope));
  if (missing.length) throw new Error(`В OAuth-приложении не включены права: ${missing.join(", ")}.`);

  const { tokens, userInfo } = await startProviderOAuthFlow(provider, normalizedClientId, undefined, {
    loginHint: account.email,
    scopes: YANDEX_SERVICE_SCOPES,
  });
  if (userInfo.email && normalizeEmail(userInfo.email) !== normalizeEmail(account.email)) {
    throw new Error(`Выполнен вход как ${userInfo.email}, ожидался аккаунт ${account.email}.`);
  }
  if (!tokens.refresh_token) throw new Error("Яндекс не вернул refresh token для API-приложения.");

  await Promise.all([
    setSetting(serviceKey(account.id, "client_id"), normalizedClientId),
    setSecureSetting(serviceKey(account.id, "access_token"), tokens.access_token),
    setSecureSetting(serviceKey(account.id, "refresh_token"), tokens.refresh_token),
    setSetting(serviceKey(account.id, "expires_at"), String(getCurrentUnixTimestamp() + tokens.expires_in)),
    setSetting(serviceKey(account.id, "scopes"), tokens.scope ?? YANDEX_SERVICE_SCOPES.join(" ")),
  ]);
}

export async function getYandexServiceContext(preferredId?: string | null) {
  const account = await resolveYandexAccount(preferredId);
  const clientId = await getYandexServiceClientId(account.id);
  let accessToken = await getSecureSetting(serviceKey(account.id, "access_token"));
  const refreshToken = await getSecureSetting(serviceKey(account.id, "refresh_token"));
  const expiresAt = Number(await getSetting(serviceKey(account.id, "expires_at")) || 0);
  if (!clientId || !accessToken || !refreshToken) {
    throw new Error("Подключите API OAuth-приложение для Диска и Трекера.");
  }
  if (expiresAt <= getCurrentUnixTimestamp() + 300) {
    const provider = getOAuthProvider("yandex");
    if (!provider) throw new Error("Конфигурация Yandex OAuth не найдена.");
    const tokens = await refreshProviderToken(provider, refreshToken, clientId);
    accessToken = tokens.access_token;
    await Promise.all([
      setSecureSetting(serviceKey(account.id, "access_token"), accessToken),
      setSecureSetting(serviceKey(account.id, "refresh_token"), tokens.refresh_token ?? refreshToken),
      setSetting(serviceKey(account.id, "expires_at"), String(getCurrentUnixTimestamp() + tokens.expires_in)),
    ]);
  }
  return { account, token: accessToken };
}

export async function parseApiError(response: Response): Promise<YandexApiError> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const code = String(body.error ?? body.code ?? "") || undefined;
  const detail = String(body.message ?? body.description ?? body.error ?? "");
  const defaults: Record<number, string> = {
    401: "Сессия Яндекса истекла. Переподключите аккаунт.",
    402: "Операция недоступна на текущем тарифе Яндекс 360.",
    403: "Недостаточно прав OAuth или прав пользователя.",
    404: "Запрошенный объект не найден.",
    409: "Операция конфликтует с текущим состоянием объекта.",
    429: "Превышен лимит запросов. Повторите позже.",
  };
  return new YandexApiError(response.status, detail || defaults[response.status] || `Яндекс API: HTTP ${response.status}`, code);
}

export async function yandexFetch<T>(url: string, init: RequestInit & { accountId?: string | null; serviceAuth?: boolean } = {}): Promise<T> {
  const { accountId, serviceAuth, ...requestInit } = init;
  const { token } = serviceAuth ? await getYandexServiceContext(accountId) : await getYandexContext(accountId);
  const response = await fetch(url, {
    ...requestInit,
    headers: { Authorization: `OAuth ${token}`, ...requestInit.headers },
  });
  if (!response.ok) throw await parseApiError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const orgKey = (accountId: string) => `yandex_org_id:${accountId}`;

export async function getStoredYandexOrgId(accountId: string): Promise<string | null> {
  return getSetting(orgKey(accountId));
}

export async function setStoredYandexOrgId(accountId: string, orgId: string): Promise<void> {
  await setSetting(orgKey(accountId), orgId.trim());
}

export async function getStoredYandexScopes(accountId: string): Promise<Set<string>> {
  const value = await getSetting(`yandex_oauth_scopes:${accountId}`);
  return new Set((value ?? "").split(/[\s,]+/).filter(Boolean));
}

export async function checkYandexScopes(accountId: string, required: string[]): Promise<{ known: boolean; missing: string[] }> {
  const scopes = await getStoredYandexScopes(accountId);
  return { known: scopes.size > 0, missing: required.filter((scope) => !scopes.has(scope)) };
}

export async function reauthorizeYandexAccount(accountId: string): Promise<void> {
  const account = await resolveYandexAccount(accountId);
  const provider = getOAuthProvider("yandex");
  if (!provider) throw new Error("Конфигурация Yandex OAuth не найдена.");

  const clientId = account.oauth_client_id || provider.publicClientId;
  if (!clientId) throw new Error("Для аккаунта не настроен Yandex OAuth Client ID.");

  const { tokens, userInfo } = await startProviderOAuthFlow(
    provider,
    clientId,
    account.oauth_client_secret ?? undefined,
    { loginHint: account.email },
  );
  if (normalizeEmail(userInfo.email) !== normalizeEmail(account.email)) {
    throw new Error(`Выполнен вход как ${userInfo.email}, ожидался аккаунт ${account.email}.`);
  }

  const refreshToken = tokens.refresh_token ?? account.refresh_token;
  if (!refreshToken) throw new Error("Яндекс не вернул refresh token. Отзовите доступ приложения и подключите аккаунт заново.");

  await updateAccountAllTokens(
    account.id,
    tokens.access_token,
    refreshToken,
    getCurrentUnixTimestamp() + tokens.expires_in,
  );
  await setSetting(`yandex_oauth_scopes:${account.id}`, tokens.scope ?? "");
}

export interface YandexOrganization { id: number | string; name?: string; }

export async function listYandexOrganizations(accountId?: string | null): Promise<YandexOrganization[]> {
  const result = await yandexFetch<YandexOrganization[] | { organizations?: YandexOrganization[] }>(
    "https://api360.yandex.net/directory/v1/org",
    { accountId, serviceAuth: true },
  );
  return Array.isArray(result) ? result : result.organizations ?? [];
}
