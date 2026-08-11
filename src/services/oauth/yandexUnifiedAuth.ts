import { getAccount, type DbAccount } from "@/services/db/accounts";
import { getSecureSetting, getSetting, setSecureSetting, setSetting } from "@/services/db/settings";
import {
  authorizeYandexServices,
  clearYandexServiceAuth,
  DEFAULT_YANDEX_SERVICE_CLIENT_ID,
  getYandexServiceContext,
  hasYandexServiceAuth,
  YANDEX_SERVICE_SCOPES,
} from "@/services/yandex/accountApi";
import { YANDEX360_ADMIN_SCOPES } from "@/services/yandex360/catalog";
import { normalizeEmail } from "@/utils/emailUtils";
import { getCurrentUnixTimestamp } from "@/utils/timestamp";
import { getOAuthProvider } from "./providers";
import { refreshProviderToken, startProviderOAuthFlow, YANDEX_DESKTOP_REDIRECT_URI } from "./oauthFlow";
import { ensureFreshToken } from "./oauthTokenManager";
import { fetchYandexLoginProfile, type YandexNormalizedProfile } from "./yandexProfile";
import { resolveYandexGrantedScopeValue } from "./yandexScopes";

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
  statusLabel: "CONNECTED" | "NEEDS ACCESS" | "ERROR";
  error?: string;
}

export interface YandexUnifiedAuthProgress {
  grant: YandexOAuthGrant;
  label: string;
  state: "authorizing" | "connected" | "failed";
  error?: string;
}

const CORE_CLIENT_ID = import.meta.env.VITE_YANDEX_OAUTH_CLIENT_ID?.trim() || "cdab208ec00f4cbc9c7a453ae6455983";
const COMMUNICATIONS_CLIENT_ID =
  import.meta.env.VITE_YANDEX_COMMUNICATIONS_OAUTH_CLIENT_ID?.trim() || "0262bbe47f6a41dba9012f63234ffb6a";
const ADMIN_CLIENT_ID =
  import.meta.env.VITE_YANDEX_ADMIN_OAUTH_CLIENT_ID?.trim() || "d51c329b72624ff1b3146166b49fda34";

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
    label: "Диск и Трекер",
    clientId: DEFAULT_YANDEX_SERVICE_CLIENT_ID,
    scopes: YANDEX_SERVICE_SCOPES,
    elevated: false,
  },
  communications: {
    id: "communications",
    label: "Мессенджер и Телемост",
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

const GRANT_FIELDS = ["access_token", "refresh_token", "expires_at", "scopes", "owner_email", "owner_uid"] as const;
type GrantField = (typeof GRANT_FIELDS)[number];
type StoredGrant = Exclude<YandexOAuthGrant, "core" | "work">;

function grantIdentity(email: string): string {
  return `email:${normalizeEmail(email)}`;
}

function grantKey(email: string, grant: StoredGrant, field: GrantField): string {
  return `yandex_oauth_${grant}_${field}:${grantIdentity(email)}`;
}

function coreOwnerUidKey(email: string): string {
  return `yandex_oauth_core_owner_uid:${grantIdentity(email)}`;
}

async function requireYandexAccount(accountId: string): Promise<DbAccount> {
  const account = await getAccount(accountId);
  if (!account || account.oauth_provider !== "yandex" || account.auth_method !== "oauth2") {
    throw new Error("Аккаунт не подключён через Яндекс ID.");
  }
  return account;
}

async function getCoreOwnerUid(account: DbAccount): Promise<string> {
  const key = coreOwnerUidKey(account.email);
  const savedUid = (await getSetting(key))?.trim();
  if (savedUid) return savedUid;

  const accessToken = await ensureFreshToken(account);
  if (!accessToken) {
    throw new Error(`Нет OAuth-токена основного аккаунта ${account.email}. Выполните повторный вход.`);
  }
  const profile = await fetchYandexLoginProfile(accessToken);
  const uid = profile.subjectId?.trim();
  if (!uid) {
    throw new Error(`Яндекс ID не вернул UID основного аккаунта ${account.email}. Выполните повторный вход.`);
  }
  await setSetting(key, uid);
  return uid;
}

async function verifyGrantOwner(
  account: DbAccount,
  profile: YandexNormalizedProfile,
): Promise<{ ownerEmail: string; ownerUid: string }> {
  const expectedUid = await getCoreOwnerUid(account);
  const ownerUid = profile.subjectId?.trim() ?? "";

  if (!ownerUid) {
    throw new Error(`Не удалось подтвердить Yandex UID для раздела аккаунта ${account.email}.`);
  }
  if (ownerUid !== expectedUid) {
    throw new Error(`Выполнен вход в другой Яндекс ID, ожидался аккаунт ${account.email}.`);
  }

  return { ownerEmail: normalizeEmail(account.email), ownerUid };
}

async function persistStoredGrant(
  account: DbAccount,
  grant: StoredGrant,
  tokens: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string;
  },
  owner: { ownerEmail: string; ownerUid: string },
): Promise<void> {
  const definition = YANDEX_OAUTH_GRANTS[grant];
  await Promise.all([
    setSecureSetting(grantKey(account.email, grant, "access_token"), tokens.access_token),
    setSecureSetting(grantKey(account.email, grant, "refresh_token"), tokens.refresh_token),
    setSetting(grantKey(account.email, grant, "expires_at"), String(getCurrentUnixTimestamp() + tokens.expires_in)),
    setSetting(
      grantKey(account.email, grant, "scopes"),
      resolveYandexGrantedScopeValue(tokens.scope, definition.scopes),
    ),
    setSetting(grantKey(account.email, grant, "owner_email"), owner.ownerEmail),
    setSetting(grantKey(account.email, grant, "owner_uid"), owner.ownerUid),
  ]);
}

async function authorizeStoredGrant(accountId: string, grant: StoredGrant): Promise<void> {
  const account = await requireYandexAccount(accountId);
  const definition = YANDEX_OAUTH_GRANTS[grant];
  if (grant === "admin" && (!definition.scopes || definition.scopes.length === 0)) {
    throw new Error("Набор прав администратора Яндекс 360 не настроен.");
  }
  const provider = getOAuthProvider("yandex");
  if (!provider) throw new Error("Конфигурация Yandex OAuth не найдена.");

  const { tokens, userInfo } = await startProviderOAuthFlow(provider, definition.clientId, undefined, {
    loginHint: account.email,
    scopes: [...definition.scopes],
    redirectUri: YANDEX_DESKTOP_REDIRECT_URI,
  });
  const owner = await verifyGrantOwner(account, userInfo);
  if (!tokens.refresh_token) {
    throw new Error(`Яндекс не вернул refresh token для раздела «${definition.label}».`);
  }

  await persistStoredGrant(account, grant, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    scope: tokens.scope,
  }, owner);
}

async function persistWorkOwnerUid(accountId: string): Promise<void> {
  try {
    const account = await requireYandexAccount(accountId);
    const key = coreOwnerUidKey(account.email);
    if ((await getSetting(key))?.trim()) return;
    const { token } = await getYandexServiceContext(accountId);
    const profile = await fetchYandexLoginProfile(token);
    const uid = profile.subjectId?.trim();
    if (uid) await setSetting(key, uid);
  } catch {
    // Ownership for work remains email-based in accountApi; UID is best-effort.
  }
}

export async function authorizeYandexGrant(
  accountId: string,
  grant: Exclude<YandexOAuthGrant, "core">,
): Promise<void> {
  if (grant === "work") {
    await authorizeYandexServices(accountId);
    await persistWorkOwnerUid(accountId);
    return;
  }
  await authorizeStoredGrant(accountId, grant);
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
  if (grant === "work") {
    const { token } = await getYandexServiceContext(accountId);
    return token;
  }

  const account = await requireYandexAccount(accountId);
  const definition = YANDEX_OAUTH_GRANTS[grant];
  let accessToken = await getSecureSetting(grantKey(account.email, grant, "access_token"));
  const refreshToken = await getSecureSetting(grantKey(account.email, grant, "refresh_token"));
  const expiresAt = Number((await getSetting(grantKey(account.email, grant, "expires_at"))) || 0);
  const ownerEmail = normalizeEmail((await getSetting(grantKey(account.email, grant, "owner_email"))) || "");
  const ownerUid = ((await getSetting(grantKey(account.email, grant, "owner_uid"))) || "").trim();

  if (!accessToken || !refreshToken) {
    throw new Error(`Подключите раздел «${definition.label}» для аккаунта ${account.email}.`);
  }

  try {
    const expectedUid = await getCoreOwnerUid(account);
    if (ownerEmail !== normalizeEmail(account.email) || !ownerUid || ownerUid !== expectedUid) {
      await clearYandexGrant(accountId, grant);
      throw new Error(`Раздел «${definition.label}» авторизован для другого Яндекс ID. Подключите его заново.`);
    }
  } catch (error) {
    if (error instanceof Error && /другой Яндекс ID/.test(error.message)) throw error;
    if (ownerEmail && ownerEmail !== normalizeEmail(account.email)) {
      await clearYandexGrant(accountId, grant);
      throw new Error(`Раздел «${definition.label}» авторизован для другого Яндекс ID. Подключите его заново.`);
    }
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
    statusLabel: account.refresh_token ? "CONNECTED" : "NEEDS ACCESS",
  }];

  const workConnected = await hasYandexServiceAuth(accountId);
  statuses.push({
    id: "work",
    label: YANDEX_OAUTH_GRANTS.work.label,
    connected: workConnected,
    elevated: false,
    scopes: workConnected ? [...YANDEX_SERVICE_SCOPES] : [],
    statusLabel: workConnected ? "CONNECTED" : "NEEDS ACCESS",
  });

  for (const grant of ["communications", "admin"] as const) {
    const scopes = ((await getSetting(grantKey(account.email, grant, "scopes"))) ?? "")
      .split(/[\s,]+/)
      .filter(Boolean);
    const refreshToken = await getSecureSetting(grantKey(account.email, grant, "refresh_token"));
    const connected = Boolean(refreshToken);
    statuses.push({
      id: grant,
      label: YANDEX_OAUTH_GRANTS[grant].label,
      connected,
      elevated: YANDEX_OAUTH_GRANTS[grant].elevated,
      scopes,
      statusLabel: connected ? "CONNECTED" : "NEEDS ACCESS",
    });
  }

  return statuses;
}

export async function clearYandexGrant(
  accountId: string,
  grant: Exclude<YandexOAuthGrant, "core">,
): Promise<void> {
  if (grant === "work") {
    await clearYandexServiceAuth(accountId);
    return;
  }

  const account = await requireYandexAccount(accountId);
  await Promise.all(GRANT_FIELDS.map((field) =>
    field === "access_token" || field === "refresh_token"
      ? setSecureSetting(grantKey(account.email, grant, field), "")
      : setSetting(grantKey(account.email, grant, field), ""),
  ));
}
