import { getAccount, getAllAccounts, type DbAccount } from "@/services/db/accounts";
import { ensureFreshToken } from "@/services/oauth/oauthTokenManager";
import { getSetting, setSetting } from "@/services/db/settings";

export class YandexApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = "YandexApiError";
  }
}

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

export async function yandexFetch<T>(url: string, init: RequestInit & { accountId?: string | null } = {}): Promise<T> {
  const { accountId, ...requestInit } = init;
  const { token } = await getYandexContext(accountId);
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

export interface YandexOrganization { id: number | string; name?: string; }

export async function listYandexOrganizations(accountId?: string | null): Promise<YandexOrganization[]> {
  const result = await yandexFetch<YandexOrganization[] | { organizations?: YandexOrganization[] }>(
    "https://api360.yandex.net/directory/v1/org",
    { accountId },
  );
  return Array.isArray(result) ? result : result.organizations ?? [];
}
