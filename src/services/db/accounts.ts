import { executeWrite, getDb, selectFirstBy } from "./connection";
import { encryptValue, decryptValue, isEncrypted } from "@/utils/crypto";
import { YANDEX_CALDAV_URL } from "@/services/calendar/yandex";

export interface DbAccount {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: number | null;
  history_id: string | null;
  last_sync_at: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
  provider: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_security: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_security: string | null;
  auth_method: string;
  imap_password: string | null;
  oauth_provider: string | null;
  oauth_client_id: string | null;
  oauth_client_secret: string | null;
  imap_username: string | null;
  caldav_url: string | null;
  caldav_username: string | null;
  caldav_password: string | null;
  caldav_principal_url: string | null;
  caldav_home_url: string | null;
  calendar_provider: string | null;
  accept_invalid_certs: number;
}

async function decryptAccountTokens(account: DbAccount): Promise<DbAccount> {
  if (account.access_token && isEncrypted(account.access_token)) {
    try {
      account.access_token = await decryptValue(account.access_token);
    } catch (err) {
      console.warn("Failed to decrypt access token, using raw value:", err);
    }
  }
  if (account.refresh_token && isEncrypted(account.refresh_token)) {
    try {
      account.refresh_token = await decryptValue(account.refresh_token);
    } catch (err) {
      console.warn("Failed to decrypt refresh token, using raw value:", err);
    }
  }
  if (account.imap_password && isEncrypted(account.imap_password)) {
    try {
      account.imap_password = await decryptValue(account.imap_password);
    } catch (err) {
      console.warn("Failed to decrypt IMAP password, using raw value:", err);
    }
  }
  if (account.oauth_client_secret && isEncrypted(account.oauth_client_secret)) {
    try {
      account.oauth_client_secret = await decryptValue(account.oauth_client_secret);
    } catch (err) {
      console.warn("Failed to decrypt OAuth client secret, using raw value:", err);
    }
  }
  if (account.caldav_password && isEncrypted(account.caldav_password)) {
    try {
      account.caldav_password = await decryptValue(account.caldav_password);
    } catch (err) {
      console.warn("Failed to decrypt CalDAV password, using raw value:", err);
    }
  }
  return account;
}

export async function getAllAccounts(): Promise<DbAccount[]> {
  const db = await getDb();
  const accounts = await db.select<DbAccount[]>(
    "SELECT * FROM accounts ORDER BY created_at ASC",
  );
  return Promise.all(accounts.map(decryptAccountTokens));
}

export async function getAccount(id: string): Promise<DbAccount | null> {
  const account = await selectFirstBy<DbAccount>(
    "SELECT * FROM accounts WHERE id = $1",
    [id],
  );
  return account ? decryptAccountTokens(account) : null;
}

export async function getAccountByEmail(
  email: string,
): Promise<DbAccount | null> {
  const account = await selectFirstBy<DbAccount>(
    "SELECT * FROM accounts WHERE email = $1",
    [email],
  );
  return account ? decryptAccountTokens(account) : null;
}

export async function insertAccount(account: {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
}): Promise<void> {
  const encAccessToken = await encryptValue(account.accessToken);
  const encRefreshToken = await encryptValue(account.refreshToken);
  await executeWrite(
    `INSERT INTO accounts (id, email, display_name, avatar_url, access_token, refresh_token, token_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      account.id,
      account.email,
      account.displayName,
      account.avatarUrl,
      encAccessToken,
      encRefreshToken,
      account.tokenExpiresAt,
    ],
  );
}

export async function updateAccountTokens(
  id: string,
  accessToken: string,
  tokenExpiresAt: number,
): Promise<void> {
  const encAccessToken = await encryptValue(accessToken);
  await executeWrite(
    "UPDATE accounts SET access_token = $1, token_expires_at = $2, updated_at = unixepoch() WHERE id = $3",
    [encAccessToken, tokenExpiresAt, id],
  );
}

export async function updateAccountSyncState(
  id: string,
  historyId: string,
): Promise<void> {
  await executeWrite(
    "UPDATE accounts SET history_id = $1, last_sync_at = unixepoch(), updated_at = unixepoch() WHERE id = $2",
    [historyId, id],
  );
}

export async function clearAccountHistoryId(id: string): Promise<void> {
  await executeWrite(
    "UPDATE accounts SET history_id = NULL, updated_at = unixepoch() WHERE id = $1",
    [id],
  );
}

export async function updateAccountAllTokens(
  id: string,
  accessToken: string,
  refreshToken: string,
  tokenExpiresAt: number,
): Promise<void> {
  const encAccessToken = await encryptValue(accessToken);
  const encRefreshToken = await encryptValue(refreshToken);
  await executeWrite(
    "UPDATE accounts SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = unixepoch() WHERE id = $4",
    [encAccessToken, encRefreshToken, tokenExpiresAt, id],
  );
}

export async function updateImapAccountPassword(
  id: string,
  password: string,
  imapUsername?: string | null,
): Promise<void> {
  const encPassword = await encryptValue(password);
  await executeWrite(
    `UPDATE accounts
     SET imap_password = $1, imap_username = COALESCE($2, imap_username), updated_at = unixepoch()
     WHERE id = $3 AND provider = 'imap'`,
    [encPassword, imapUsername ?? null, id],
  );
}

export async function deleteAccount(id: string): Promise<void> {
  await executeWrite("DELETE FROM accounts WHERE id = $1", [id]);
}

export async function insertImapAccount(account: {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  authMethod: string;
  password: string;
  imapUsername?: string | null;
  acceptInvalidCerts?: boolean;
}): Promise<void> {
  const encPassword = await encryptValue(account.password);
  await executeWrite(
    `INSERT INTO accounts (id, email, display_name, avatar_url, access_token, refresh_token, provider, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security, auth_method, imap_password, imap_username, accept_invalid_certs)
     VALUES ($1, $2, $3, $4, NULL, NULL, 'imap', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      account.id,
      account.email,
      account.displayName,
      account.avatarUrl,
      account.imapHost,
      account.imapPort,
      account.imapSecurity,
      account.smtpHost,
      account.smtpPort,
      account.smtpSecurity,
      account.authMethod,
      encPassword,
      account.imapUsername || null,
      account.acceptInvalidCerts ? 1 : 0,
    ],
  );
}

export async function insertCalDavAccount(account: {
  id: string;
  email: string;
  displayName: string | null;
  caldavUrl: string;
  caldavUsername: string;
  caldavPassword: string;
  caldavPrincipalUrl?: string | null;
  caldavHomeUrl?: string | null;
}): Promise<void> {
  const encPassword = await encryptValue(account.caldavPassword);
  await executeWrite(
    `INSERT INTO accounts (id, email, display_name, avatar_url, access_token, refresh_token, provider, calendar_provider, caldav_url, caldav_username, caldav_password, caldav_principal_url, caldav_home_url)
     VALUES ($1, $2, $3, NULL, NULL, NULL, 'caldav', 'caldav', $4, $5, $6, $7, $8)`,
    [
      account.id,
      account.email,
      account.displayName,
      account.caldavUrl,
      account.caldavUsername,
      encPassword,
      account.caldavPrincipalUrl ?? null,
      account.caldavHomeUrl ?? null,
    ],
  );
}

export async function updateAccountCalDav(
  accountId: string,
  fields: {
    caldavUrl: string;
    caldavUsername: string;
    caldavPassword: string;
    caldavPrincipalUrl?: string | null;
    caldavHomeUrl?: string | null;
    calendarProvider: string;
  },
): Promise<void> {
  const encPassword = await encryptValue(fields.caldavPassword);
  await executeWrite(
    `UPDATE accounts SET caldav_url = $1, caldav_username = $2, caldav_password = $3,
       caldav_principal_url = $4, caldav_home_url = $5, calendar_provider = $6,
       updated_at = unixepoch() WHERE id = $7`,
    [
      fields.caldavUrl,
      fields.caldavUsername,
      encPassword,
      fields.caldavPrincipalUrl ?? null,
      fields.caldavHomeUrl ?? null,
      fields.calendarProvider,
      accountId,
    ],
  );
}

export async function insertOAuthImapAccount(account: {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  oauthProvider: string;
  oauthClientId: string;
  oauthClientSecret: string | null;
  imapUsername?: string | null;
  acceptInvalidCerts?: boolean;
}): Promise<void> {
  const encAccessToken = await encryptValue(account.accessToken);
  const encRefreshToken = await encryptValue(account.refreshToken);
  const encClientSecret = account.oauthClientSecret
    ? await encryptValue(account.oauthClientSecret)
    : null;
  const calDavUrl = account.oauthProvider === "yandex" ? YANDEX_CALDAV_URL : null;
  const calDavUsername = account.oauthProvider === "yandex" ? account.email : null;
  const calendarProvider = account.oauthProvider === "yandex" ? "caldav" : null;
  await executeWrite(
    `INSERT INTO accounts (id, email, display_name, avatar_url, access_token, refresh_token, token_expires_at, provider, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security, auth_method, imap_password, oauth_provider, oauth_client_id, oauth_client_secret, imap_username, accept_invalid_certs, caldav_url, caldav_username, calendar_provider)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'imap', $8, $9, $10, $11, $12, $13, 'oauth2', NULL, $14, $15, $16, $17, $18, $19, $20, $21)`,
    [
      account.id,
      account.email,
      account.displayName,
      account.avatarUrl,
      encAccessToken,
      encRefreshToken,
      account.tokenExpiresAt,
      account.imapHost,
      account.imapPort,
      account.imapSecurity,
      account.smtpHost,
      account.smtpPort,
      account.smtpSecurity,
      account.oauthProvider,
      account.oauthClientId,
      encClientSecret,
      account.imapUsername || null,
      account.acceptInvalidCerts ? 1 : 0,
      calDavUrl,
      calDavUsername,
      calendarProvider,
    ],
  );
}

export async function updateOAuthImapAccount(account: {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  imapHost: string;
  imapPort: number;
  imapSecurity: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  oauthProvider: string;
  oauthClientId: string;
  oauthClientSecret: string | null;
  imapUsername?: string | null;
  acceptInvalidCerts?: boolean;
}): Promise<void> {
  const encAccessToken = await encryptValue(account.accessToken);
  const encRefreshToken = await encryptValue(account.refreshToken);
  const encClientSecret = account.oauthClientSecret
    ? await encryptValue(account.oauthClientSecret)
    : null;
  const shouldEnableYandexCalendar = account.oauthProvider === "yandex";

  await executeWrite(
    `UPDATE accounts
     SET email = $1,
         display_name = COALESCE($2, display_name),
         avatar_url = COALESCE($3, avatar_url),
         access_token = $4,
         refresh_token = $5,
         token_expires_at = $6,
         provider = 'imap',
         imap_host = $7,
         imap_port = $8,
         imap_security = $9,
         smtp_host = $10,
         smtp_port = $11,
         smtp_security = $12,
         auth_method = 'oauth2',
         imap_password = NULL,
         oauth_provider = $13,
         oauth_client_id = $14,
         oauth_client_secret = $15,
         imap_username = $16,
         accept_invalid_certs = $17,
         caldav_url = CASE WHEN $19 = 1 AND (caldav_url IS NULL OR caldav_url = '') THEN $20 ELSE caldav_url END,
         caldav_username = CASE WHEN $19 = 1 AND (caldav_username IS NULL OR caldav_username = '') THEN $1 ELSE caldav_username END,
         calendar_provider = CASE WHEN $19 = 1 AND (calendar_provider IS NULL OR calendar_provider = '') THEN 'caldav' ELSE calendar_provider END,
         updated_at = unixepoch()
     WHERE id = $18`,
    [
      account.email,
      account.displayName,
      account.avatarUrl,
      encAccessToken,
      encRefreshToken,
      account.tokenExpiresAt,
      account.imapHost,
      account.imapPort,
      account.imapSecurity,
      account.smtpHost,
      account.smtpPort,
      account.smtpSecurity,
      account.oauthProvider,
      account.oauthClientId,
      encClientSecret,
      account.imapUsername || null,
      account.acceptInvalidCerts ? 1 : 0,
      account.id,
      shouldEnableYandexCalendar ? 1 : 0,
      YANDEX_CALDAV_URL,
    ],
  );
}
