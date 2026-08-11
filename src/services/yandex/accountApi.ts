import { getAccount, getAllAccounts, updateAccountAllTokens, type DbAccount } from "@/services/db/accounts";
import { ensureFreshToken } from "@/services/oauth/oauthTokenManager";
import { getAllSettings, getSecureSetting, getSetting, setSecureSetting, setSetting } from "@/services/db/settings";
import { getOAuthProvider } from "@/services/oauth/providers";
import {
  refreshProviderToken,
  startProviderOAuthFlow,
  YANDEX_DESKTOP_REDIRECT_URI,
} from "@/services/oauth/oauthFlow";
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
  "directory:read_organization",
];

export const YANDEX_DIRECTORY_ORG_SCOPE = "directory:read_organization";

/** Canonical Office360 Disk/Tracker OAuth app (public client + PKCE, localhost:17248). */
export const DEFAULT_YANDEX_SERVICE_CLIENT_ID = "9a7396c327984bd6afc75debf275850f";

/** Legacy «диск тест» app — only verification_code callback; do not use for desktop managed OAuth. */
export const LEGACY_YANDEX_SERVICE_CLIENT_ID = "69e59ec6dcfe4be3a085006d49678056";

const SERVICE_SETTING_NAMES = ["client_id", "access_token", "refresh_token", "expires_at", "scopes", "owner_email"] as const;
type ServiceSettingName = typeof SERVICE_SETTING_NAMES[number];

const serviceKey = (identity: string, name: ServiceSettingName) => `yandex_services_${name}:${identity}`;
const serviceIdentity = (account: DbAccount) => `email:${normalizeEmail(account.email)}`;

function resolveManagedServiceClientId(stored: string | null | undefined): string {
  const value = stored?.trim() || "";
  if (!value || value === LEGACY_YANDEX_SERVICE_CLIENT_ID) {
    return DEFAULT_YANDEX_SERVICE_CLIENT_ID;
  }
  return value;
}

async function migrateYandexServiceSettings(account: DbAccount): Promise<void> {
  const identity = serviceIdentity(account);
  if (await getSetting(serviceKey(identity, "refresh_token"))) return;

  const settings = await getAllSettings();
  const sourceIdentity = settings[serviceKey(account.id, "refresh_token")] ? account.id : null;
  if (!sourceIdentity) return;

  await Promise.all(SERVICE_SETTING_NAMES.map(async (name) => {
    const value = settings[serviceKey(sourceIdentity, name)];
    if (value) await setSetting(serviceKey(identity, name), value);
  }));
}

export async function resolveYandexAccount(preferredId?: string | null): Promise<DbAccount> {
  if (preferredId) {
    const account = await getAccount(preferredId);
    if (account?.oauth_provider === "yandex" && account.auth_method === "oauth2") return account;
    throw new Error("Активный аккаунт не подключён через Яндекс ID.");
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

export async function getYandexServiceClientId(accountId: string): Promise<string> {
  const account = await resolveYandexAccount(accountId);
  await migrateYandexServiceSettings(account);
  const identity = serviceIdentity(account);
  const stored = await getSetting(serviceKey(identity, "client_id"));
  if (stored?.trim() === LEGACY_YANDEX_SERVICE_CLIENT_ID) {
    // Drop tokens issued under the old test OAuth app; force re-consent on the canonical client.
    await Promise.all([
      setSetting(serviceKey(identity, "client_id"), ""),
      setSecureSetting(serviceKey(identity, "access_token"), ""),
      setSecureSetting(serviceKey(identity, "refresh_token"), ""),
      setSetting(serviceKey(identity, "expires_at"), ""),
      setSetting(serviceKey(identity, "scopes"), ""),
      setSetting(serviceKey(identity, "owner_email"), ""),
    ]);
  }
  return resolveManagedServiceClientId(stored);
}

export async function hasYandexServiceAuth(accountId: string): Promise<boolean> {
  const account = await resolveYandexAccount(accountId);
  await migrateYandexServiceSettings(account);
  const identity = serviceIdentity(account);
  const [accessToken, refreshToken] = await Promise.all([
    getSecureSetting(serviceKey(identity, "access_token")),
    getSecureSetting(serviceKey(identity, "refresh_token")),
  ]);
  return Boolean(accessToken && refreshToken);
}

export async function clearYandexServiceAuth(accountId: string): Promise<void> {
  const account = await resolveYandexAccount(accountId);
  await migrateYandexServiceSettings(account);
  const identity = serviceIdentity(account);
  await Promise.all([
    setSecureSetting(serviceKey(identity, "access_token"), ""),
    setSecureSetting(serviceKey(identity, "refresh_token"), ""),
    setSetting(serviceKey(identity, "expires_at"), ""),
    setSetting(serviceKey(identity, "scopes"), ""),
    setSetting(serviceKey(identity, "owner_email"), ""),
  ]);
}

export function isYandexServiceAuthRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Диск|Трекер|service auth|разрешить Office360 доступ|Выдайте доступ заново|OAuth Диска принадлежит/i.test(message)
    && /доступ|OAuth|права|токен|подключ/i.test(message);
}

/**
 * Managed Disk/Tracker OAuth for the Office360 Yandex service client (PKCE, no secret).
 * Optional clientId is a developer override only — never prompt end users for it.
 */
export async function authorizeYandexServices(accountId: string, clientId?: string | null): Promise<void> {
  const account = await resolveYandexAccount(accountId);
  const provider = getOAuthProvider("yandex");
  if (!provider) throw new Error("Конфигурация Yandex OAuth не найдена.");
  const normalizedClientId = (clientId?.trim() || await getYandexServiceClientId(accountId) || DEFAULT_YANDEX_SERVICE_CLIENT_ID).trim();
  if (!normalizedClientId) throw new Error("Не настроен Office360 Yandex OAuth Client ID для Диска и Трекера.");

  const infoResponse = await tauriFetch(`https://oauth.yandex.ru/client/${encodeURIComponent(normalizedClientId)}/info`);
  if (!infoResponse.ok) throw new Error("Не удалось проверить Yandex OAuth Client ID Office360.");
  const info = await infoResponse.json() as { scope?: string[]; callback?: string };
  const allowed = new Set(info.scope ?? []);
  const missing = YANDEX_SERVICE_SCOPES.filter((scope) => !allowed.has(scope));
  if (missing.length) {
    throw new Error(
      `В OAuth-приложении Office360 не включены права: ${missing.join(", ")}. Обратитесь в поддержку Office360.`,
    );
  }

  // Same desktop loopback as Mail OAuth. Do not use verification_code (OOB/CEF) — no code field in UI.
  // Requires redirect URI http://localhost:17248 on the Office360 service OAuth app in Yandex Console.
  const { tokens, userInfo } = await startProviderOAuthFlow(provider, normalizedClientId, undefined, {
    loginHint: account.email,
    scopes: YANDEX_SERVICE_SCOPES,
    redirectUri: YANDEX_DESKTOP_REDIRECT_URI,
  });
  if (userInfo.email && normalizeEmail(userInfo.email) !== normalizeEmail(account.email)) {
    throw new Error(`Выполнен вход как ${userInfo.email}, ожидался аккаунт ${account.email}.`);
  }
  if (!tokens.refresh_token) throw new Error("Яндекс не вернул refresh token для Диска и Трекера.");

  const identity = serviceIdentity(account);
  await Promise.all([
    setSetting(serviceKey(identity, "client_id"), normalizedClientId),
    setSecureSetting(serviceKey(identity, "access_token"), tokens.access_token),
    setSecureSetting(serviceKey(identity, "refresh_token"), tokens.refresh_token),
    setSetting(serviceKey(identity, "expires_at"), String(getCurrentUnixTimestamp() + tokens.expires_in)),
    setSetting(serviceKey(identity, "scopes"), tokens.scope ?? YANDEX_SERVICE_SCOPES.join(" ")),
    setSetting(serviceKey(identity, "owner_email"), normalizeEmail(account.email)),
  ]);
}

export async function getYandexServiceContext(preferredId?: string | null) {
  const account = await resolveYandexAccount(preferredId);
  await migrateYandexServiceSettings(account);
  const identity = serviceIdentity(account);
  const clientId = await getYandexServiceClientId(account.id);
  let accessToken = await getSecureSetting(serviceKey(identity, "access_token"));
  const refreshToken = await getSecureSetting(serviceKey(identity, "refresh_token"));
  const expiresAt = Number(await getSetting(serviceKey(identity, "expires_at")) || 0);
  if (!clientId || !accessToken || !refreshToken) {
    throw new Error("Для работы с Диском и Трекером разрешите Office360 доступ к Яндекс Диску и Трекеру.");
  }
  if (expiresAt <= getCurrentUnixTimestamp() + 300) {
    const provider = getOAuthProvider("yandex");
    if (!provider) throw new Error("Конфигурация Yandex OAuth не найдена.");
    const tokens = await refreshProviderToken(provider, refreshToken, clientId);
    accessToken = tokens.access_token;
    await Promise.all([
      setSecureSetting(serviceKey(identity, "access_token"), accessToken),
      setSecureSetting(serviceKey(identity, "refresh_token"), tokens.refresh_token ?? refreshToken),
      setSetting(serviceKey(identity, "expires_at"), String(getCurrentUnixTimestamp() + tokens.expires_in)),
    ]);
  }
  let ownerEmail = normalizeEmail(await getSetting(serviceKey(identity, "owner_email")) || "");
  if (!ownerEmail) {
    const profileResponse = await tauriFetch("https://login.yandex.ru/info?format=json", {
      headers: { Authorization: `OAuth ${accessToken}` },
    });
    if (!profileResponse.ok) throw await parseApiError(profileResponse as unknown as Response);
    const profile = await profileResponse.json() as { default_email?: string; login?: string };
    ownerEmail = normalizeEmail(profile.default_email || (profile.login ? `${profile.login}@yandex.ru` : ""));
    if (ownerEmail) await setSetting(serviceKey(identity, "owner_email"), ownerEmail);
  }
  if (!ownerEmail || ownerEmail !== normalizeEmail(account.email)) {
    await Promise.all([
      setSecureSetting(serviceKey(identity, "access_token"), ""),
      setSecureSetting(serviceKey(identity, "refresh_token"), ""),
      setSetting(serviceKey(identity, "owner_email"), ""),
    ]);
    throw new Error(`OAuth Диска принадлежит ${ownerEmail || "другому аккаунту"}, а выбран ${account.email}. Выдайте доступ заново.`);
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

export interface YandexOrganization { id: number | string; name?: string; email?: string; }

export type YandexOrgResolveResult =
  | { status: "ready"; orgId: string; source: "stored" | "auto" }
  | { status: "pick"; organizations: YandexOrganization[] }
  | {
      status: "manual";
      reason: "empty" | "directory_forbidden" | "auth_expired" | "network" | "unknown";
      message: string;
      needsReconsent: boolean;
    };

export async function listYandexOrganizations(accountId?: string | null): Promise<YandexOrganization[]> {
  const { token } = await getYandexServiceContext(accountId);
  let response: Response;
  try {
    response = await fetch("https://api360.yandex.net/directory/v1/org?pageSize=100", {
      headers: { Authorization: `OAuth ${token}`, Accept: "application/json" },
    });
  } catch {
    throw new YandexApiError(0, "Не удалось связаться с Яндекс 360. Проверьте сеть и повторите.", "network");
  }
  if (!response.ok) {
    if (response.status === 401) {
      throw new YandexApiError(
        401,
        "Сессия Office360 истекла. Нажмите «Обновить доступ», чтобы войти снова.",
        "auth_expired",
      );
    }
    if (response.status === 403) {
      throw new YandexApiError(
        403,
        "Нужно обновить доступ Office360: приложению требуется право читать организации Яндекс 360.",
        "directory_scope_missing",
      );
    }
    if (response.status === 404) {
      throw new YandexApiError(404, "Организации Яндекс 360 не найдены для этого аккаунта.", "org_not_found");
    }
    throw await parseApiError(response);
  }
  const result = await response.json() as YandexOrganization[] | { organizations?: YandexOrganization[] };
  return Array.isArray(result) ? result : result.organizations ?? [];
}

/** Hybrid org resolution: stored → Directory auto/pick → manual fallback. */
export async function resolveYandexOrgForTracker(accountId: string): Promise<YandexOrgResolveResult> {
  const account = await resolveYandexAccount(accountId);
  const stored = (await getStoredYandexOrgId(account.id))?.trim() || "";
  if (stored) return { status: "ready", orgId: stored, source: "stored" };

  try {
    const organizations = await listYandexOrganizations(accountId);
    if (organizations.length === 1) {
      const orgId = String(organizations[0]!.id);
      await setStoredYandexOrgId(account.id, orgId);
      return { status: "ready", orgId, source: "auto" };
    }
    if (organizations.length > 1) {
      return { status: "pick", organizations };
    }
    return {
      status: "manual",
      reason: "empty",
      message: "Организации Яндекс 360 не найдены. Укажите идентификатор организации вручную.",
      needsReconsent: false,
    };
  } catch (error) {
    if (error instanceof YandexApiError) {
      if (error.code === "directory_scope_missing" || error.status === 403) {
        return {
          status: "manual",
          reason: "directory_forbidden",
          message: error.message,
          needsReconsent: true,
        };
      }
      if (error.code === "auth_expired" || error.status === 401) {
        return {
          status: "manual",
          reason: "auth_expired",
          message: error.message,
          needsReconsent: true,
        };
      }
      if (error.code === "network" || error.status === 0) {
        return {
          status: "manual",
          reason: "network",
          message: error.message,
          needsReconsent: false,
        };
      }
      return {
        status: "manual",
        reason: "unknown",
        message: error.message,
        needsReconsent: false,
      };
    }
    const message = error instanceof Error ? error.message : String(error ?? "Неизвестная ошибка");
    const needsService = isYandexServiceAuthRequiredError(error);
    return {
      status: "manual",
      reason: needsService ? "auth_expired" : "unknown",
      message,
      needsReconsent: needsService,
    };
  }
}
