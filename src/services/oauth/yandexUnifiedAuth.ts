import { getAccount, type DbAccount } from "@/services/db/accounts";
import { getSecureSetting, getSetting, setSecureSetting, setSetting } from "@/services/db/settings";
import { YANDEX360_ADMIN_SCOPES } from "@/services/yandex360/catalog";
import { normalizeEmail } from "@/utils/emailUtils";
import { getCurrentUnixTimestamp } from "@/utils/timestamp";
import { getOAuthProvider } from "./providers";
import { refreshProviderToken, startProviderOAuthFlow } from "./oauthFlow";

export type YandexOAuthGrant = "core" | "work" | "communications" | "admin";

export interface YandexOAuthGrantDefinition {
  id: YandexOAuthGrant;
  label: string;
  clientId: string;
  scopes: readonly string[];
  elevated: boolean;
}

export interface YandexOAuthGrantStatus {
  id: YandexOAuthGrant;
  label: string;
  connected: boolean;
  elevated: boolean;
  scopes: string[];
}

export interface YandexUnifiedAuthProgress {
  grant: YandexOAuthGrant;
  label: string;
  state: "authorizing" | "connected" | "failed";
  error?: string;
}

const CORE_CLIENT_ID = import.meta.env.VITE_YANDEX_OAUTH_CLIENT_ID?.trim() || "cdab208ec00f4cbc9c7a453ae6455983";
const WORK_CLIENT_ID = import.meta.env.VITE_YANDEX_WORK_OAUTH_CLIENT_ID?.trim() || "796ed39c28944ad4bbe5c6bfc63b9294";
const COMMUNICATIONS_CLIENT_ID = import.meta.env.VITE_YANDEX_COMMUNICATIONS_OAUTH_CLIENT_ID?.trim() || "0262bbe47f6a41dba9012f63234ffb6a";
const ADMIN_CLIENT_ID = import.meta.env.VITE_YANDEX_ADMIN_OAUTH_CLIENT_ID?.trim() || "d51c329b72624ff1b3146166b49fda34";

export const YANDEX_OAUTH_GRANTS: Record<YandexOAuthGrant, YandexOAuthGrantDefinition> = {
  core: {
    id: "core",
    label: "Основное",
    clientId: CORE_CLIENT_ID,
    scopes: ["login:email", "login:info", "login:avatar", "mail:imap_full", "mail:smtp", "calendar:all"],
    elevated: false,
  },
  work: {
    id: "work",
    label: "Работа",
    clientId: WORK_CLIENT_ID,
    scopes: [
      "cloud_api:disk.read",
      "cloud_api:disk.write",
      "cloud_api:disk.info",
      "tracker:read",
      "tracker:write",
      "directory:read_organization",
    ],
    elevated: false,
  },
  communications: {
    id: "communications",
    label: "Коммуникации",
    clientId: COMMUNICATIONS_CLIENT_ID,
    scopes: [
      "yamb:all",
      "messenger:vconf",
      "telemost-api:conferences.read",
      "telemost-api:conferences.create",
      "telemost-api:conferences.update",
      "telemost-api:conferences.delete",
    ],
    elevated: false,
  },
  admin: {
    id: "admin",
    label: "Администрирование",
    clientId: ADMIN_CLIENT_ID,
    scopes: YANDEX360_ADMIN_SCOPES,
    elevated: true,
  },
};

const GRANT_FIELDS = ["access_token", "refresh_token", "expires_at", "scopes", "owner_email"] as const;
type GrantField = typeof GRANT_FIELDS[number];

function grantIdentity(email: string): string {
  return `email:${normalizeEmail(email)}`;
}

function grantKey(email: string, grant: Exclude<YandexOAuthGrant, "core">, field: GrantField): string {
  return `yandex_oauth_${grant}_${field}:${grantIdentity(email)}`;
}

async function requireYandexAccount(accountId: string): Promise<DbAccount> {
  const account = await getAccount(accountId);
  if (!account || account.oauth_provider !== "yandex" || account.auth_method !== "oauth2") {
    throw new Error("Аккаунт не подключён через Яндекс ID.");
  }
  return account;
}

export async function authorizeYandexGrant(
  accountId: string,
  grant: Exclude<YandexOAuthGrant, "core">,
): Promise<void> {
  const account = await requireYandexAccount(accountId);
  const definition = YANDEX_OAUTH_GRANTS[grant];
  const provider = getOAuthProvider("yandex");
  if (!provider) throw new Error("Конфигурация Yandex OAuth не найдена.");

  const { tokens, userInfo } = await startProviderOAuthFlow(provider, definition.clientId, undefined, {
    loginHint: account.email,
    scopes: [...definition.scopes],
  });
  const ownerEmail = normalizeEmail(userInfo.email);
  if (!ownerEmail || ownerEmail !== normalizeEmail(account.email)) {
    throw new Error(`Выполнен вход как ${userInfo.email || "другой аккаунт"}, ожидался ${account.email}.`);
  }
  if (!tokens.refresh_token) {
    throw new Error(`Яндекс не вернул refresh token для раздела «${definition.label}».`);
  }

  await Promise.all([
    setSecureSetting(grantKey(account.email, grant, "access_token"), tokens.access_token),
    setSecureSetting(grantKey(account.email, grant, "refresh_token"), tokens.refresh_token),
    setSetting(grantKey(account.email, grant, "expires_at"), String(getCurrentUnixTimestamp() + tokens.expires_in)),
    setSetting(grantKey(account.email, grant, "scopes"), tokens.scope ?? definition.scopes.join(" ")),
    setSetting(grantKey(account.email, grant, "owner_email"), ownerEmail),
  ]);
}

export async function authorizeYandexSuite(
  accountId: string,
  options: {
    grants?: Array<Exclude<YandexOAuthGrant, "core">>;
    onProgress?: (progress: YandexUnifiedAuthProgress) => void;
    continueOnError?: boolean;
  } = {},
): Promise<YandexUnifiedAuthProgress[]> {
  const grants = options.grants ?? ["work", "communications"];
  const results: YandexUnifiedAuthProgress[] = [];

  for (const grant of grants) {
    const definition = YANDEX_OAUTH_GRANTS[grant];
    options.onProgress?.({ grant, label: definition.label, state: "authorizing" });
    try {
      await authorizeYandexGrant(accountId, grant);
      const result: YandexUnifiedAuthProgress = { grant, label: definition.label, state: "connected" };
      results.push(result);
      options.onProgress?.(result);
    } catch (error) {
      const result: YandexUnifiedAuthProgress = {
        grant,
        label: definition.label,
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(result);
      options.onProgress?.(result);
      if (!options.continueOnError) throw error;
    }
  }

  return results;
}

export async function getYandexGrantAccessToken(
  accountId: string,
  grant: Exclude<YandexOAuthGrant, "core">,
): Promise<string> {
  const account = await requireYandexAccount(accountId);
  const definition = YANDEX_OAUTH_GRANTS[grant];
  let accessToken = await getSecureSetting(grantKey(account.email, grant, "access_token"));
  const refreshToken = await getSecureSetting(grantKey(account.email, grant, "refresh_token"));
  const expiresAt = Number(await getSetting(grantKey(account.email, grant, "expires_at")) || 0);
  const ownerEmail = normalizeEmail(await getSetting(grantKey(account.email, grant, "owner_email")) || "");

  if (!accessToken || !refreshToken) {
    throw new Error(`Подключите раздел «${definition.label}» для аккаунта ${account.email}.`);
  }
  if (ownerEmail !== normalizeEmail(account.email)) {
    await clearYandexGrant(account.email, grant);
    throw new Error(`Раздел «${definition.label}» авторизован для другого Яндекс ID. Подключите его заново.`);
  }

  if (expiresAt <= getCurrentUnixTimestamp() + 300) {
    const provider = getOAuthProvider("yandex");
    if (!provider) throw new Error("Конфигурация Yandex OAuth не найдена.");
    const tokens = await refreshProviderToken(provider, refreshToken, definition.clientId);
    accessToken = tokens.access_token;
    await Promise.all([
      setSecureSetting(grantKey(account.email, grant, "access_token"), accessToken),
      setSecureSetting(grantKey(account.email, grant, "refresh_token"), tokens.refresh_token ?? refreshToken),
      setSetting(grantKey(account.email, grant, "expires_at"), String(getCurrentUnixTimestamp() + tokens.expires_in)),
      tokens.scope ? setSetting(grantKey(account.email, grant, "scopes"), tokens.scope) : Promise.resolve(),
    ]);
  }

  return accessToken;
}

export async function getYandexUnifiedAuthStatus(accountId: string): Promise<YandexOAuthGrantStatus[]> {
  const account = await requireYandexAccount(accountId);
  const coreScopes = new Set((account.oauth_granted_scopes ?? "").split(/[\s,]+/).filter(Boolean));
  const statuses: YandexOAuthGrantStatus[] = [{
    id: "core",
    label: YANDEX_OAUTH_GRANTS.core.label,
    connected: Boolean(account.refresh_token),
    elevated: false,
    scopes: [...coreScopes],
  }];

  for (const grant of ["work", "communications", "admin"] as const) {
    const scopes = (await getSetting(grantKey(account.email, grant, "scopes")) ?? "")
      .split(/[\s,]+/)
      .filter(Boolean);
    const refreshToken = await getSecureSetting(grantKey(account.email, grant, "refresh_token"));
    statuses.push({
      id: grant,
      label: YANDEX_OAUTH_GRANTS[grant].label,
      connected: Boolean(refreshToken),
      elevated: YANDEX_OAUTH_GRANTS[grant].elevated,
      scopes,
    });
  }

  return statuses;
}

export async function clearYandexGrant(
  email: string,
  grant: Exclude<YandexOAuthGrant, "core">,
): Promise<void> {
  await Promise.all(GRANT_FIELDS.map((field) =>
    field === "access_token" || field === "refresh_token"
      ? setSecureSetting(grantKey(email, grant, field), "")
      : setSetting(grantKey(email, grant, field), ""),
  ));
}
