import { getDb, selectFirstBy, withTransaction } from "./connection";
import { normalizeEmail } from "@/utils/emailUtils";

export interface DbContact {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  frequency: number;
  last_contacted_at: number | null;
  notes: string | null;
  contact_type?: "inferred" | "managed" | string | null;
  user_edited?: number | null;
  vcard_uid?: string | null;
  vcard_raw?: string | null;
  organization?: string | null;
  title?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  sync_provider?: string | null;
  sync_account_id?: string | null;
  sync_etag?: string | null;
  sync_status?: string | null;
  deleted_at?: number | null;
  directory_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  role?: string | null;
  timezone?: string | null;
  birthday?: string | null;
  anniversary?: string | null;
  remote_url?: string | null;
  remote_uid?: string | null;
  sync_hash?: string | null;
  last_synced_at?: number | null;
  read_only?: number | null;
}

export interface ContactIdentity {
  id: string;
  contact_id: string;
  email: string;
  label: string | null;
  display_name: string | null;
  is_primary: number;
  source_type: string | null;
}

export interface ContactSearchResult extends DbContact {
  identity_email?: string | null;
  identity_display_name?: string | null;
  identity_label?: string | null;
  identity_is_primary?: number | null;
}

export interface ManagedContact extends DbContact {
  identities: ContactIdentity[];
}

export type ContactDirectoryKind = "local" | "collected" | "carddav" | "ldap";

export interface ContactDirectory {
  id: string;
  name: string;
  kind: ContactDirectoryKind;
  source_type: string | null;
  source_id: string | null;
  account_id: string | null;
  server_url: string | null;
  username: string | null;
  auth_ref: string | null;
  remote_url: string | null;
  sync_token: string | null;
  ctag: string | null;
  sync_status: string | null;
  sync_error: string | null;
  read_only: number;
  ldap_host: string | null;
  ldap_port: number | null;
  ldap_security: string | null;
  ldap_base_dn: string | null;
  ldap_filter: string | null;
  ldap_bind_dn: string | null;
  created_at: number | null;
  updated_at: number | null;
  last_synced_at: number | null;
}

export interface ContactMethod {
  id: string;
  contact_id: string;
  kind: "email" | "phone" | "url" | "impp" | string;
  value: string;
  label: string | null;
  display_name: string | null;
  is_primary: number;
  sort_order: number;
  source_type: string | null;
}

export interface ContactPostalAddress {
  id: string;
  contact_id: string;
  label: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  sort_order: number;
}

export interface ContactSpecialDate {
  id: string;
  contact_id: string;
  kind: "birthday" | "anniversary" | "custom" | string;
  value: string;
  label: string | null;
  sort_order: number;
}

export interface RichContact extends ManagedContact {
  directory: ContactDirectory | null;
  methods: ContactMethod[];
  addresses: ContactPostalAddress[];
  specialDates: ContactSpecialDate[];
}

export interface ContactMethodInput {
  kind: ContactMethod["kind"];
  value: string;
  label?: string | null;
  displayName?: string | null;
  isPrimary?: boolean;
  sortOrder?: number;
}

export interface ContactAddressInput {
  label?: string | null;
  street?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  sortOrder?: number;
}

export interface ContactSpecialDateInput {
  kind: ContactSpecialDate["kind"];
  value: string;
  label?: string | null;
  sortOrder?: number;
}

export interface SaveRichContactInput extends SaveManagedContactInput {
  directoryId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  role?: string | null;
  timezone?: string | null;
  birthday?: string | null;
  anniversary?: string | null;
  remoteUrl?: string | null;
  remoteUid?: string | null;
  syncEtag?: string | null;
  syncStatus?: string | null;
  readOnly?: boolean;
  methods?: ContactMethodInput[];
  addresses?: ContactAddressInput[];
  specialDates?: ContactSpecialDateInput[];
}

export interface ContactList {
  id: string;
  directory_id: string;
  name: string;
  nickname: string | null;
  description: string | null;
  source_type: string | null;
  remote_url: string | null;
  sync_etag: string | null;
  created_at: number | null;
  updated_at: number | null;
  deleted_at: number | null;
}

export interface ContactListMember {
  id: string;
  list_id: string;
  contact_id: string | null;
  email: string;
  display_name: string | null;
  sort_order: number;
}

export interface ContactListWithMembers extends ContactList {
  members: ContactListMember[];
}

export interface ContactAttachment {
  filename: string;
  mime_type: string | null;
  size: number | null;
  date: number;
}

export interface SameDomainContact {
  email: string;
  display_name: string | null;
  avatar_url: string | null;
}

type ContactIdentityInput =
  | string
  | {
    email: string;
    label?: string | null;
    displayName?: string | null;
    isPrimary?: boolean;
  };

export interface SaveManagedContactInput {
  id?: string;
  displayName: string | null;
  avatarUrl?: string | null;
  identities: ContactIdentityInput[];
  primaryEmail?: string | null;
  notes?: string | null;
  organization?: string | null;
  title?: string | null;
  vcardUid?: string | null;
  rawVcard?: string | null;
  sourceType?: string | null;
}

export interface ParsedVCardContact {
  uid: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  emails: string[];
  emailLabels: Map<string, string | null>;
  phones: ContactMethodInput[];
  urls: ContactMethodInput[];
  addresses: ContactAddressInput[];
  specialDates: ContactSpecialDateInput[];
  timezone: string | null;
  notes: string | null;
  organization: string | null;
  title: string | null;
  role: string | null;
  impps: ContactMethodInput[];
}

interface NormalizedIdentityInput {
  email: string;
  label: string | null;
  displayName: string | null;
  isPrimary: boolean;
}

function normalizeIdentityInputs(
  identities: ContactIdentityInput[],
  primaryEmail?: string | null,
): NormalizedIdentityInput[] {
  const normalizedPrimary = primaryEmail ? normalizeEmail(primaryEmail) : null;
  const byEmail = new Map<string, NormalizedIdentityInput>();

  for (const identity of identities) {
    const rawEmail = typeof identity === "string" ? identity : identity.email;
    const email = normalizeEmail(rawEmail);
    if (!email) continue;
    const existing = byEmail.get(email);
    const next: NormalizedIdentityInput = {
      email,
      label: typeof identity === "string" ? null : identity.label ?? null,
      displayName: typeof identity === "string" ? null : identity.displayName ?? null,
      isPrimary: (typeof identity !== "string" && identity.isPrimary === true) || email === normalizedPrimary,
    };
    byEmail.set(email, {
      email,
      label: next.label ?? existing?.label ?? null,
      displayName: next.displayName ?? existing?.displayName ?? null,
      isPrimary: next.isPrimary || existing?.isPrimary === true,
    });
  }

  const out = [...byEmail.values()];
  if (out.length === 0) return out;

  let primaryIndex = out.findIndex((identity) => identity.isPrimary);
  if (primaryIndex === -1) primaryIndex = 0;

  return out.map((identity, index) => ({
    ...identity,
    isPrimary: index === primaryIndex,
  }));
}

function primaryEmailFromIdentities(identities: NormalizedIdentityInput[]): string {
  return identities.find((identity) => identity.isPrimary)?.email ?? identities[0]!.email;
}

function normalizeMethodValue(kind: string, value: string): string {
  if (kind === "email") return normalizeEmail(value);
  return value.trim();
}

function normalizeContactMethods(
  methods: ContactMethodInput[] | undefined,
  identities: NormalizedIdentityInput[],
): ContactMethodInput[] {
  const out: ContactMethodInput[] = [];
  const seen = new Set<string>();

  for (const identity of identities) {
    const key = `email:${identity.email}`;
    seen.add(key);
    out.push({
      kind: "email",
      value: identity.email,
      label: identity.label,
      displayName: identity.displayName,
      isPrimary: identity.isPrimary,
      sortOrder: identity.isPrimary ? 0 : out.length + 1,
    });
  }

  for (const method of methods ?? []) {
    const kind = method.kind.trim().toLowerCase();
    const value = normalizeMethodValue(kind, method.value);
    if (!kind || !value) continue;
    const key = `${kind}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...method,
      kind,
      value,
      sortOrder: method.sortOrder ?? out.length,
      isPrimary: method.isPrimary === true,
    });
  }

  const primaryMethodKinds = new Set<string>();
  return out.map((method, index) => {
    const isEmail = method.kind === "email";
    const isPrimary = isEmail
      ? method.isPrimary === true
      : method.isPrimary === true && !primaryMethodKinds.has(method.kind);
    if (!isEmail && isPrimary) primaryMethodKinds.add(method.kind);
    return {
      ...method,
      sortOrder: method.sortOrder ?? index,
      isPrimary,
    };
  });
}

function normalizeAddressInputs(addresses: ContactAddressInput[] | undefined): Required<ContactAddressInput>[] {
  return (addresses ?? [])
    .map((address, index) => ({
      label: address.label?.trim() || null,
      street: address.street?.trim() || null,
      city: address.city?.trim() || null,
      region: address.region?.trim() || null,
      postalCode: address.postalCode?.trim() || null,
      country: address.country?.trim() || null,
      sortOrder: address.sortOrder ?? index,
    }))
    .filter((address) => Boolean(
      address.street || address.city || address.region || address.postalCode || address.country,
    ));
}

function normalizeSpecialDateInputs(dates: ContactSpecialDateInput[] | undefined): Required<ContactSpecialDateInput>[] {
  return (dates ?? [])
    .map((date, index) => ({
      kind: date.kind?.trim().toLowerCase() || "custom",
      value: date.value?.trim() || "",
      label: date.label?.trim() || null,
      sortOrder: date.sortOrder ?? index,
    }))
    .filter((date) => Boolean(date.value));
}

export async function ensureDefaultContactDirectories(): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR IGNORE INTO contact_directories (id, name, kind, source_type, read_only)
     VALUES
       ('personal', 'Personal Address Book', 'local', 'local', 0),
       ('collected', 'Collected Addresses', 'collected', 'inferred', 0)`,
  );
}

function escapeVCardValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function unescapeVCardValue(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseVCardParams(keyPart: string): Record<string, string> {
  const params: Record<string, string> = {};
  const parts = keyPart.split(";").slice(1);
  for (const part of parts) {
    const [rawKey, ...rest] = part.split("=");
    const key = rawKey?.trim().toUpperCase();
    if (!key) continue;
    params[key] = rest.join("=").replace(/^"|"$/g, "");
  }
  return params;
}

function labelFromVCardParams(params: Record<string, string>): string | null {
  const raw = params["TYPE"] ?? params["X-ABLABEL"];
  if (!raw) return null;
  return raw.split(",").map((part) => part.trim()).filter((part) => part && !/^pref$/i.test(part))[0] ?? null;
}

function splitEscapedVCardList(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      current += `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === ";") {
      out.push(unescapeVCardValue(current));
      current = "";
      continue;
    }
    current += char;
  }
  out.push(unescapeVCardValue(current));
  return out;
}

function unfoldVCardLines(vcard: string): string[] {
  return vcard
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .reduce<string[]>((lines, line) => {
      if (/^[ \t]/.test(line) && lines.length > 0) {
        lines[lines.length - 1] += line.slice(1);
      } else if (line.trim()) {
        lines.push(line);
      }
      return lines;
    }, []);
}

function contactLookupWhere(alias = "c"): string {
  return `${alias}.id = (
    SELECT contact_id FROM contact_identities WHERE email = $1 LIMIT 1
  ) OR ${alias}.email = $1`;
}

/**
 * Search contacts by email, identity email, or name prefix for autocomplete.
 */
export async function searchContacts(
  query: string,
  limit = 10,
): Promise<ContactSearchResult[]> {
  const db = await getDb();
  const normalized = normalizeEmail(query);
  const pattern = `%${query}%`;
  const normalizedPattern = `%${normalized || query.toLowerCase()}%`;

  return db.select<ContactSearchResult[]>(
    `SELECT
       c.*,
       ci.email AS identity_email,
       ci.display_name AS identity_display_name,
       ci.label AS identity_label,
       ci.is_primary AS identity_is_primary
     FROM contacts c
     LEFT JOIN contact_identities ci ON ci.contact_id = c.id
     WHERE c.deleted_at IS NULL
       AND (
         c.email LIKE $1
         OR c.display_name LIKE $1
         OR ci.email LIKE $2
         OR ci.display_name LIKE $1
       )
     ORDER BY
       CASE
         WHEN ci.email = $3 THEN 0
         WHEN ci.email LIKE $2 THEN 1
         WHEN c.email LIKE $2 THEN 2
         WHEN c.display_name LIKE $1 THEN 3
         ELSE 4
       END,
       CASE WHEN c.contact_type = 'managed' THEN 0 ELSE 1 END,
       ci.is_primary DESC,
       c.frequency DESC,
       c.display_name ASC,
       ci.email ASC
     LIMIT $4`,
    [pattern, normalizedPattern, normalized, limit],
  );
}

/**
 * Get all contacts, ordered by frequency descending.
 */
export async function getAllContacts(
  limit = 500,
  offset = 0,
): Promise<DbContact[]> {
  const db = await getDb();
  return db.select<DbContact[]>(
    `SELECT * FROM contacts
     WHERE deleted_at IS NULL
     ORDER BY frequency DESC, display_name ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
}

export async function getContactIdentities(contactId: string): Promise<ContactIdentity[]> {
  const db = await getDb();
  return db.select<ContactIdentity[]>(
    `SELECT * FROM contact_identities
     WHERE contact_id = $1
     ORDER BY is_primary DESC, email ASC`,
    [contactId],
  );
}

export async function getAllContactsWithIdentities(
  limit = 500,
  offset = 0,
): Promise<ManagedContact[]> {
  const contacts = await getAllContacts(limit, offset);
  if (contacts.length === 0) return [];

  const db = await getDb();
  const placeholders = contacts.map((_, index) => `$${index + 1}`).join(", ");
  const identities = await db.select<ContactIdentity[]>(
    `SELECT * FROM contact_identities
     WHERE contact_id IN (${placeholders})
     ORDER BY is_primary DESC, email ASC`,
    contacts.map((contact) => contact.id),
  );
  const byContact = new Map<string, ContactIdentity[]>();
  for (const identity of identities) {
    const items = byContact.get(identity.contact_id) ?? [];
    items.push(identity);
    byContact.set(identity.contact_id, items);
  }

  return contacts.map((contact) => ({
    ...contact,
    identities: byContact.get(contact.id) ?? [{
      id: `${contact.id}:legacy`,
      contact_id: contact.id,
      email: contact.email,
      label: null,
      display_name: contact.display_name,
      is_primary: 1,
      source_type: contact.source_type ?? "inferred",
    }],
  }));
}

export async function getContactDirectories(): Promise<ContactDirectory[]> {
  await ensureDefaultContactDirectories();
  const db = await getDb();
  return db.select<ContactDirectory[]>(
    `SELECT * FROM contact_directories
     ORDER BY
       CASE id WHEN 'personal' THEN 0 WHEN 'collected' THEN 1 ELSE 2 END,
       name ASC`,
  );
}

export interface SaveContactDirectoryInput {
  id?: string;
  name: string;
  kind: ContactDirectoryKind;
  serverUrl?: string | null;
  username?: string | null;
  authRef?: string | null;
  remoteUrl?: string | null;
  readOnly?: boolean;
  ldapHost?: string | null;
  ldapPort?: number | null;
  ldapSecurity?: string | null;
  ldapBaseDn?: string | null;
  ldapFilter?: string | null;
  ldapBindDn?: string | null;
}

export async function saveContactDirectory(input: SaveContactDirectoryInput): Promise<ContactDirectory> {
  await ensureDefaultContactDirectories();
  const db = await getDb();
  const id = input.id ?? crypto.randomUUID();
  await db.execute(
    `INSERT INTO contact_directories (
       id, name, kind, server_url, username, auth_ref, remote_url, read_only,
       ldap_host, ldap_port, ldap_security, ldap_base_dn, ldap_filter, ldap_bind_dn,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, unixepoch())
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       kind = excluded.kind,
       server_url = excluded.server_url,
       username = excluded.username,
       auth_ref = excluded.auth_ref,
       remote_url = excluded.remote_url,
       read_only = excluded.read_only,
       ldap_host = excluded.ldap_host,
       ldap_port = excluded.ldap_port,
       ldap_security = excluded.ldap_security,
       ldap_base_dn = excluded.ldap_base_dn,
       ldap_filter = excluded.ldap_filter,
       ldap_bind_dn = excluded.ldap_bind_dn,
       updated_at = unixepoch()`,
    [
      id,
      input.name.trim() || "Address Book",
      input.kind,
      input.serverUrl ?? null,
      input.username ?? null,
      input.authRef ?? null,
      input.remoteUrl ?? null,
      input.readOnly ? 1 : 0,
      input.ldapHost ?? null,
      input.ldapPort ?? null,
      input.ldapSecurity ?? null,
      input.ldapBaseDn ?? null,
      input.ldapFilter ?? null,
      input.ldapBindDn ?? null,
    ],
  );
  const saved = await selectFirstBy<ContactDirectory>(
    "SELECT * FROM contact_directories WHERE id = $1 LIMIT 1",
    [id],
  );
  if (!saved) throw new Error("Address book save failed");
  return saved;
}

export async function getRichContact(contactId: string): Promise<RichContact | null> {
  const contact = await selectFirstBy<DbContact>(
    "SELECT * FROM contacts WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
    [contactId],
  );
  if (!contact) return null;

  const db = await getDb();
  const [identities, methods, addresses, specialDates, directory] = await Promise.all([
    getContactIdentities(contactId),
    db.select<ContactMethod[]>(
      `SELECT * FROM contact_methods WHERE contact_id = $1 ORDER BY kind, sort_order, value`,
      [contactId],
    ),
    db.select<ContactPostalAddress[]>(
      `SELECT * FROM contact_addresses WHERE contact_id = $1 ORDER BY sort_order`,
      [contactId],
    ),
    db.select<ContactSpecialDate[]>(
      `SELECT * FROM contact_special_dates WHERE contact_id = $1 ORDER BY sort_order`,
      [contactId],
    ),
    contact.directory_id
      ? selectFirstBy<ContactDirectory>("SELECT * FROM contact_directories WHERE id = $1 LIMIT 1", [contact.directory_id])
      : Promise.resolve(null),
  ]);

  return {
    ...contact,
    identities,
    methods,
    addresses,
    specialDates,
    directory,
  };
}

export async function saveRichContact(input: SaveRichContactInput): Promise<RichContact> {
  const identityInputs = [...input.identities];
  for (const method of input.methods ?? []) {
    if (method.kind === "email") identityInputs.push({
      email: method.value,
      label: method.label,
      displayName: method.displayName,
      isPrimary: method.isPrimary,
    });
  }

  const identities = normalizeIdentityInputs(identityInputs, input.primaryEmail);
  if (identities.length === 0) {
    throw new Error("Contact requires at least one email address");
  }

  const saved = await saveManagedContact({
    ...input,
    identities,
    primaryEmail: input.primaryEmail ?? identities.find((identity) => identity.isPrimary)?.email ?? identities[0]!.email,
  });

  const methods = normalizeContactMethods(input.methods, identities);
  const addresses = normalizeAddressInputs(input.addresses);
  const specialDates = normalizeSpecialDateInputs([
    ...(input.birthday ? [{ kind: "birthday", value: input.birthday }] : []),
    ...(input.anniversary ? [{ kind: "anniversary", value: input.anniversary }] : []),
    ...(input.specialDates ?? []),
  ]);
  const syncEtagProvided = Object.prototype.hasOwnProperty.call(input, "syncEtag") ? 1 : 0;
  const syncStatusProvided = Object.prototype.hasOwnProperty.call(input, "syncStatus") ? 1 : 0;

  await withTransaction(async (lockedDb) => {
    await lockedDb.execute(
      `UPDATE contacts
       SET directory_id = COALESCE($1, directory_id, 'personal'),
           first_name = $2,
           last_name = $3,
           nickname = $4,
           role = $5,
           timezone = $6,
           birthday = $7,
           anniversary = $8,
           remote_url = COALESCE($9, remote_url),
           remote_uid = COALESCE($10, remote_uid),
           sync_etag = CASE WHEN $11 = 1 THEN $12 ELSE sync_etag END,
           sync_status = CASE WHEN $13 = 1 THEN $14 ELSE sync_status END,
           read_only = $15,
           updated_at = unixepoch()
       WHERE id = $16`,
      [
        input.directoryId ?? null,
        input.firstName ?? null,
        input.lastName ?? null,
        input.nickname ?? null,
        input.role ?? null,
        input.timezone ?? null,
        input.birthday ?? null,
        input.anniversary ?? null,
        input.remoteUrl ?? null,
        input.remoteUid ?? null,
        syncEtagProvided,
        input.syncEtag ?? null,
        syncStatusProvided,
        input.syncStatus ?? null,
        input.readOnly ? 1 : saved.read_only ?? 0,
        saved.id,
      ],
    );

    await lockedDb.execute("DELETE FROM contact_methods WHERE contact_id = $1", [saved.id]);
    for (const method of methods) {
      await lockedDb.execute(
        `INSERT INTO contact_methods (
           id, contact_id, kind, value, label, display_name, is_primary, sort_order, source_type, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, unixepoch())`,
        [
          crypto.randomUUID(),
          saved.id,
          method.kind,
          method.value,
          method.label ?? null,
          method.displayName ?? null,
          method.isPrimary ? 1 : 0,
          method.sortOrder ?? 0,
          input.sourceType ?? saved.source_type ?? "local",
        ],
      );
    }

    await lockedDb.execute("DELETE FROM contact_addresses WHERE contact_id = $1", [saved.id]);
    for (const address of addresses) {
      await lockedDb.execute(
        `INSERT INTO contact_addresses (
           id, contact_id, label, street, city, region, postal_code, country, sort_order, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, unixepoch())`,
        [
          crypto.randomUUID(),
          saved.id,
          address.label,
          address.street,
          address.city,
          address.region,
          address.postalCode,
          address.country,
          address.sortOrder,
        ],
      );
    }

    await lockedDb.execute("DELETE FROM contact_special_dates WHERE contact_id = $1", [saved.id]);
    for (const date of specialDates) {
      await lockedDb.execute(
        `INSERT INTO contact_special_dates (
           id, contact_id, kind, value, label, sort_order, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, unixepoch())`,
        [
          crypto.randomUUID(),
          saved.id,
          date.kind,
          date.value,
          date.label,
          date.sortOrder,
        ],
      );
    }
  });

  const rich = await getRichContact(saved.id);
  if (!rich) throw new Error("Contact save failed");
  return rich;
}

export async function getContactLists(directoryId?: string | null): Promise<ContactListWithMembers[]> {
  const db = await getDb();
  const lists = await db.select<ContactList[]>(
    `SELECT * FROM contact_lists
     WHERE deleted_at IS NULL AND ($1 IS NULL OR directory_id = $1)
     ORDER BY name ASC`,
    [directoryId ?? null],
  );
  if (lists.length === 0) return [];
  const placeholders = lists.map((_, index) => `$${index + 1}`).join(", ");
  const members = await db.select<ContactListMember[]>(
    `SELECT * FROM contact_list_members
     WHERE list_id IN (${placeholders})
     ORDER BY sort_order, email`,
    lists.map((list) => list.id),
  );
  const byList = new Map<string, ContactListMember[]>();
  for (const member of members) {
    const items = byList.get(member.list_id) ?? [];
    items.push(member);
    byList.set(member.list_id, items);
  }
  return lists.map((list) => ({ ...list, members: byList.get(list.id) ?? [] }));
}

export async function saveContactList(input: {
  id?: string;
  directoryId: string;
  name: string;
  nickname?: string | null;
  description?: string | null;
  members: { contactId?: string | null; email: string; displayName?: string | null }[];
}): Promise<ContactListWithMembers> {
  const id = input.id ?? crypto.randomUUID();
  const members = input.members
    .map((member, index) => ({
      contactId: member.contactId ?? null,
      email: normalizeEmail(member.email),
      displayName: member.displayName?.trim() || null,
      sortOrder: index,
    }))
    .filter((member) => Boolean(member.email));

  await withTransaction(async (lockedDb) => {
    await lockedDb.execute(
      `INSERT INTO contact_lists (
         id, directory_id, name, nickname, description, source_type, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, 'local', unixepoch())
       ON CONFLICT(id) DO UPDATE SET
         directory_id = excluded.directory_id,
         name = excluded.name,
         nickname = excluded.nickname,
         description = excluded.description,
         updated_at = unixepoch(),
         deleted_at = NULL`,
      [id, input.directoryId, input.name.trim() || "Mailing List", input.nickname ?? null, input.description ?? null],
    );
    await lockedDb.execute("DELETE FROM contact_list_members WHERE list_id = $1", [id]);
    for (const member of members) {
      await lockedDb.execute(
        `INSERT OR REPLACE INTO contact_list_members (
           id, list_id, contact_id, email, display_name, sort_order
         )
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), id, member.contactId, member.email, member.displayName, member.sortOrder],
      );
    }
  });

  const list = (await getContactLists(input.directoryId)).find((item) => item.id === id);
  if (!list) throw new Error("Mailing list save failed");
  return list;
}

export async function deleteContactList(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE contact_lists SET deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = $1",
    [id],
  );
}

export interface RecipientSuggestion {
  id: string;
  kind: "contact" | "list";
  label: string;
  address: string;
  detail: string | null;
}

export async function searchRecipientSuggestions(query: string, limit = 10): Promise<RecipientSuggestion[]> {
  const contacts = await searchContacts(query, limit);
  const db = await getDb();
  const pattern = `%${query}%`;
  const normalizedPattern = `%${normalizeEmail(query) || query.toLowerCase()}%`;
  const lists = await db.select<(ContactList & { member_count: number })[]>(
    `SELECT l.*, COUNT(m.id) AS member_count
     FROM contact_lists l
     LEFT JOIN contact_list_members m ON m.list_id = l.id
     WHERE l.deleted_at IS NULL
       AND (l.name LIKE $1 OR l.nickname LIKE $1 OR m.email LIKE $2)
     GROUP BY l.id
     ORDER BY l.name ASC
     LIMIT $3`,
    [pattern, normalizedPattern, limit],
  );

  return [
    ...contacts.map((contact): RecipientSuggestion => ({
      id: contact.id,
      kind: "contact",
      label: contact.display_name ?? contact.identity_display_name ?? contact.identity_email ?? contact.email,
      address: contact.identity_email ?? contact.email,
      detail: contact.identity_label ?? contact.organization ?? null,
    })),
    ...lists.map((list): RecipientSuggestion => ({
      id: list.id,
      kind: "list",
      label: list.name,
      address: list.nickname ? `${list.nickname} <${list.name}>` : list.name,
      detail: `${list.member_count} member${list.member_count === 1 ? "" : "s"}`,
    })),
  ].slice(0, limit);
}

/**
 * Update a contact's display name.
 */
export async function updateContact(
  id: string,
  displayName: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE contacts
     SET display_name = $1,
         contact_type = 'managed',
         user_edited = 1,
         source_type = COALESCE(NULLIF(source_type, 'inferred'), 'local'),
         updated_at = unixepoch()
     WHERE id = $2`,
    [displayName, id],
  );
}

/**
 * Delete a contact by ID.
 */
export async function deleteContact(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM contact_identities WHERE contact_id = $1", [id]);
  await db.execute("DELETE FROM contacts WHERE id = $1", [id]);
}

/**
 * Upsert a contact from mail activity. User-edited managed fields are preserved.
 */
export async function upsertContact(
  email: string,
  displayName: string | null,
): Promise<void> {
  await ensureDefaultContactDirectories();
  const db = await getDb();
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  const existing = await getContactByEmail(normalized);
  if (existing) {
    const preserveName = existing.user_edited === 1;
    await db.execute(
      `UPDATE contacts
       SET display_name = CASE WHEN $1 = 1 THEN display_name ELSE COALESCE($2, display_name) END,
           frequency = frequency + 1,
           last_contacted_at = unixepoch(),
           updated_at = unixepoch()
       WHERE id = $3`,
      [preserveName ? 1 : 0, displayName, existing.id],
    );
    await db.execute(
      `INSERT OR IGNORE INTO contact_identities (
         id, contact_id, email, display_name, is_primary, source_type
       )
       VALUES ($1, $2, $3, $4, CASE WHEN $5 = $3 THEN 1 ELSE 0 END, 'inferred')`,
      [crypto.randomUUID(), existing.id, normalized, displayName, existing.email],
    );
    await db.execute(
      `INSERT OR IGNORE INTO contact_methods (
         id, contact_id, kind, value, display_name, is_primary, source_type
       )
       VALUES ($1, $2, 'email', $3, $4, CASE WHEN $5 = $3 THEN 1 ELSE 0 END, 'inferred')`,
      [crypto.randomUUID(), existing.id, normalized, displayName, existing.email],
    );
    return;
  }

  const id = crypto.randomUUID();
  await withTransaction(async (lockedDb) => {
    await lockedDb.execute(
       `INSERT INTO contacts (
         id, email, display_name, contact_type, user_edited, source_type, directory_id, last_contacted_at
       )
       VALUES ($1, $2, $3, 'inferred', 0, 'inferred', 'collected', unixepoch())`,
      [id, normalized, displayName],
    );
    await lockedDb.execute(
      `INSERT INTO contact_identities (
         id, contact_id, email, display_name, is_primary, source_type
       )
       VALUES ($1, $2, $3, $4, 1, 'inferred')`,
      [crypto.randomUUID(), id, normalized, displayName],
    );
    await lockedDb.execute(
      `INSERT INTO contact_methods (
         id, contact_id, kind, value, display_name, is_primary, source_type
       )
       VALUES ($1, $2, 'email', $3, $4, 1, 'inferred')`,
      [crypto.randomUUID(), id, normalized, displayName],
    );
  });
}

export async function saveManagedContact(input: SaveManagedContactInput): Promise<ManagedContact> {
  await ensureDefaultContactDirectories();
  const identities = normalizeIdentityInputs(input.identities, input.primaryEmail);
  if (identities.length === 0) {
    throw new Error("Managed contact requires at least one email identity");
  }

  const primaryEmail = primaryEmailFromIdentities(identities);
  const existing = input.id
    ? await selectFirstBy<DbContact>("SELECT * FROM contacts WHERE id = $1 LIMIT 1", [input.id])
    : await getContactByEmail(primaryEmail);
  const id = existing?.id ?? input.id ?? crypto.randomUUID();
  const sourceType = input.sourceType ?? existing?.source_type ?? "local";
  const notesProvided = Object.prototype.hasOwnProperty.call(input, "notes") ? 1 : 0;
  const avatarProvided = Object.prototype.hasOwnProperty.call(input, "avatarUrl") ? 1 : 0;

  await withTransaction(async (lockedDb) => {
    if (existing) {
      await lockedDb.execute(
        `UPDATE contacts
         SET email = $1,
             display_name = $2,
             notes = CASE WHEN $3 = 1 THEN $4 ELSE notes END,
             contact_type = 'managed',
             user_edited = 1,
             vcard_uid = COALESCE($5, vcard_uid),
             vcard_raw = COALESCE($6, vcard_raw),
             organization = COALESCE($7, organization),
             title = COALESCE($8, title),
             avatar_url = CASE WHEN $9 = 1 THEN $10 ELSE avatar_url END,
             source_type = $11,
             directory_id = COALESCE(directory_id, 'personal'),
             updated_at = unixepoch()
         WHERE id = $12`,
        [
          primaryEmail,
          input.displayName,
          notesProvided,
          input.notes ?? null,
          input.vcardUid ?? null,
          input.rawVcard ?? null,
          input.organization ?? null,
          input.title ?? null,
          avatarProvided,
          input.avatarUrl ?? null,
          sourceType,
          id,
        ],
      );
    } else {
      await lockedDb.execute(
        `INSERT INTO contacts (
           id, email, display_name, avatar_url, notes, contact_type, user_edited,
           vcard_uid, vcard_raw, organization, title, source_type, directory_id
         )
         VALUES ($1, $2, $3, $4, $5, 'managed', 1, $6, $7, $8, $9, $10, 'personal')`,
        [
          id,
          primaryEmail,
          input.displayName,
          input.avatarUrl ?? null,
          input.notes ?? null,
          input.vcardUid ?? null,
          input.rawVcard ?? null,
          input.organization ?? null,
          input.title ?? null,
          sourceType,
        ],
      );
    }

    await lockedDb.execute("DELETE FROM contact_identities WHERE contact_id = $1", [id]);
    await lockedDb.execute("DELETE FROM contact_methods WHERE contact_id = $1 AND kind = 'email'", [id]);
    for (const identity of identities) {
      await lockedDb.execute(
        `INSERT OR REPLACE INTO contact_identities (
           id, contact_id, email, label, display_name, is_primary, source_type, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, unixepoch())`,
        [
          crypto.randomUUID(),
          id,
          identity.email,
          identity.label,
          identity.displayName,
          identity.isPrimary ? 1 : 0,
          sourceType,
        ],
      );
      await lockedDb.execute(
        `INSERT INTO contact_methods (
           id, contact_id, kind, value, label, display_name, is_primary, sort_order, source_type, updated_at
         )
         VALUES ($1, $2, 'email', $3, $4, $5, $6, $7, $8, unixepoch())`,
        [
          crypto.randomUUID(),
          id,
          identity.email,
          identity.label,
          identity.displayName,
          identity.isPrimary ? 1 : 0,
          identity.isPrimary ? 0 : 10,
          sourceType,
        ],
      );
    }
  });

  const saved = await selectFirstBy<DbContact>("SELECT * FROM contacts WHERE id = $1 LIMIT 1", [id]);
  if (!saved) throw new Error("Managed contact save failed");
  return {
    ...saved,
    identities: await getContactIdentities(id),
  };
}

export async function getContactByEmail(
  email: string,
): Promise<DbContact | null> {
  const normalized = normalizeEmail(email);
  return selectFirstBy<DbContact>(
    `SELECT c.*
     FROM contacts c
     LEFT JOIN contact_identities ci ON ci.contact_id = c.id
     WHERE (${contactLookupWhere("c")}) AND c.deleted_at IS NULL
     ORDER BY CASE WHEN ci.email = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [normalized],
  );
}

/**
 * Batch display-name substitution for message lists (key is normalized identity email).
 */
export async function getContactDisplayNameMap(emails: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(emails.map((e) => normalizeEmail(e)).filter(Boolean))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;

  const db = await getDb();
  const chunkSize = 400;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const ph = chunk.map((_, j) => `$${j + 1}`).join(", ");
    const rows = await db.select<{ email: string; display_name: string | null }[]>(
      `SELECT ci.email, COALESCE(ci.display_name, c.display_name) AS display_name
       FROM contact_identities ci
       INNER JOIN contacts c ON c.id = ci.contact_id
       WHERE ci.email IN (${ph})
       UNION
       SELECT email, display_name FROM contacts WHERE email IN (${ph})`,
      chunk,
    );
    for (const r of rows) {
      const dn = r.display_name?.trim();
      if (dn) out.set(normalizeEmail(r.email), dn);
    }
  }
  return out;
}

export interface ContactStats {
  emailCount: number;
  firstEmail: number | null;
  lastEmail: number | null;
}

export async function getContactStats(
  email: string,
): Promise<ContactStats> {
  const db = await getDb();
  const rows = await db.select<{ cnt: number; first_date: number | null; last_date: number | null }[]>(
    `SELECT COUNT(*) as cnt, MIN(date) as first_date, MAX(date) as last_date
     FROM messages WHERE from_address = $1`,
    [normalizeEmail(email)],
  );
  const row = rows[0];
  return {
    emailCount: row?.cnt ?? 0,
    firstEmail: row?.first_date ?? null,
    lastEmail: row?.last_date ?? null,
  };
}

export async function getRecentThreadsWithContact(
  email: string,
  limit = 5,
): Promise<{ thread_id: string; subject: string | null; last_message_at: number | null }[]> {
  const db = await getDb();
  return db.select(
    `SELECT DISTINCT t.id as thread_id, t.subject, t.last_message_at
     FROM threads t
     INNER JOIN messages m ON m.account_id = t.account_id AND m.thread_id = t.id
     WHERE m.from_address = $1
     ORDER BY t.last_message_at DESC
     LIMIT $2`,
    [normalizeEmail(email), limit],
  );
}

export async function updateContactAvatar(
  email: string,
  avatarUrl: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE contacts
     SET avatar_url = $1, updated_at = unixepoch()
     WHERE id IN (SELECT contact_id FROM contact_identities WHERE email = $2)
        OR email = $2`,
    [avatarUrl, normalizeEmail(email)],
  );
}

/**
 * Update a contact's notes by email or identity email.
 */
export async function updateContactNotes(
  email: string,
  notes: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE contacts
     SET notes = $1, updated_at = unixepoch()
     WHERE id IN (SELECT contact_id FROM contact_identities WHERE email = $2)
        OR email = $2`,
    [notes || null, normalizeEmail(email)],
  );
}

/**
 * Get recent non-inline attachments from a contact.
 */
export async function getAttachmentsFromContact(
  email: string,
  limit = 5,
): Promise<ContactAttachment[]> {
  const db = await getDb();
  return db.select<ContactAttachment[]>(
    `SELECT a.filename, a.mime_type, a.size, m.date
     FROM attachments a
     INNER JOIN messages m ON m.account_id = a.account_id AND m.id = a.message_id
     WHERE m.from_address = $1 AND a.is_inline = 0 AND a.filename IS NOT NULL
     ORDER BY m.date DESC
     LIMIT $2`,
    [normalizeEmail(email), limit],
  );
}

const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com",
  "live.com", "yahoo.com", "yahoo.co.uk", "aol.com", "icloud.com",
  "me.com", "mac.com", "protonmail.com", "proton.me", "mail.com",
  "zoho.com", "yandex.com", "gmx.com", "gmx.net",
]);

/**
 * Get other contacts from the same email domain (e.g., colleagues).
 * Skips public email providers.
 */
export async function getContactsFromSameDomain(
  email: string,
  limit = 5,
): Promise<SameDomainContact[]> {
  const normalized = normalizeEmail(email);
  const atIdx = normalized.indexOf("@");
  if (atIdx === -1) return [];

  const domain = normalized.slice(atIdx + 1);
  if (PUBLIC_DOMAINS.has(domain)) return [];

  const db = await getDb();
  return db.select<SameDomainContact[]>(
    `SELECT
       ci.email,
       COALESCE(ci.display_name, c.display_name) AS display_name,
       c.avatar_url
     FROM contact_identities ci
     INNER JOIN contacts c ON c.id = ci.contact_id
     WHERE ci.email LIKE $1 AND ci.email != $2 AND c.deleted_at IS NULL
     ORDER BY c.frequency DESC
     LIMIT $3`,
    [`%@${domain}`, normalized, limit],
  );
}

/**
 * Get the most recent auth_results JSON string for messages from this sender.
 */
export async function getLatestAuthResult(
  email: string,
): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ auth_results: string | null }[]>(
    `SELECT auth_results FROM messages
     WHERE from_address = $1 AND auth_results IS NOT NULL
     ORDER BY date DESC
     LIMIT 1`,
    [normalizeEmail(email)],
  );
  return rows[0]?.auth_results ?? null;
}

export function parseVCard(vcard: string): ParsedVCardContact {
  const lines = unfoldVCardLines(vcard);
  const emails: string[] = [];
  const emailLabels = new Map<string, string | null>();
  const phones: ContactMethodInput[] = [];
  const urls: ContactMethodInput[] = [];
  const addresses: ContactAddressInput[] = [];
  const specialDates: ContactSpecialDateInput[] = [];
  const impps: ContactMethodInput[] = [];
  let uid: string | null = null;
  let displayName: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;
  let nickname: string | null = null;
  let notes: string | null = null;
  let organization: string | null = null;
  let title: string | null = null;
  let role: string | null = null;
  let timezone: string | null = null;

  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const keyPart = line.slice(0, separator);
    const key = keyPart.split(";")[0]!.toUpperCase();
    const params = parseVCardParams(keyPart);
    const value = unescapeVCardValue(line.slice(separator + 1).trim());
    if (key === "UID") uid = value || null;
    if (key === "FN") displayName = value || null;
    if (key === "N") {
      const nameParts = splitEscapedVCardList(line.slice(separator + 1).trim());
      lastName = nameParts[0] || null;
      firstName = nameParts[1] || null;
    }
    if (key === "NICKNAME") nickname = value || null;
    if (key === "EMAIL") {
      const normalized = normalizeEmail(value);
      if (normalized && !emails.includes(normalized)) {
        emails.push(normalized);
        emailLabels.set(normalized, labelFromVCardParams(params));
      }
    }
    if (key === "TEL" && value) {
      phones.push({ kind: "phone", value, label: labelFromVCardParams(params), isPrimary: /pref/i.test(params["TYPE"] ?? "") });
    }
    if (key === "URL" && value) {
      urls.push({ kind: "url", value, label: labelFromVCardParams(params), isPrimary: /pref/i.test(params["TYPE"] ?? "") });
    }
    if (key === "ADR") {
      const parts = splitEscapedVCardList(line.slice(separator + 1).trim());
      addresses.push({
        label: labelFromVCardParams(params),
        street: [parts[2], parts[1]].filter(Boolean).join("\n") || null,
        city: parts[3] || null,
        region: parts[4] || null,
        postalCode: parts[5] || null,
        country: parts[6] || null,
      });
    }
    if (key === "BDAY" && value) specialDates.push({ kind: "birthday", value });
    if ((key === "ANNIVERSARY" || key === "X-ANNIVERSARY") && value) {
      specialDates.push({ kind: "anniversary", value });
    }
    if (key === "TZ") timezone = value || null;
    if (key === "NOTE") notes = value || null;
    if (key === "ORG") organization = value || null;
    if (key === "TITLE") title = value || null;
    if (key === "ROLE") role = value || null;
    if (key === "IMPP" && value) {
      impps.push({ kind: "impp", value, label: labelFromVCardParams(params) });
    }
  }

  return {
    uid,
    displayName,
    firstName,
    lastName,
    nickname,
    emails,
    emailLabels,
    phones,
    urls,
    addresses,
    specialDates,
    timezone,
    notes,
    organization,
    title,
    role,
    impps,
  };
}

export async function importVCard(vcard: string): Promise<ManagedContact> {
  const parsed = parseVCard(vcard);
  if (parsed.emails.length === 0) {
    throw new Error("vCard import requires at least one EMAIL field");
  }

  return saveRichContact({
    displayName: parsed.displayName,
    identities: parsed.emails.map((email, index) => ({
      email,
      label: parsed.emailLabels.get(email) ?? null,
      isPrimary: index === 0,
    })),
    primaryEmail: parsed.emails[0] ?? null,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    nickname: parsed.nickname,
    notes: parsed.notes,
    organization: parsed.organization,
    title: parsed.title,
    role: parsed.role,
    timezone: parsed.timezone,
    birthday: parsed.specialDates.find((date) => date.kind === "birthday")?.value ?? null,
    anniversary: parsed.specialDates.find((date) => date.kind === "anniversary")?.value ?? null,
    methods: [...parsed.phones, ...parsed.urls, ...parsed.impps],
    addresses: parsed.addresses,
    specialDates: parsed.specialDates.filter((date) => date.kind !== "birthday" && date.kind !== "anniversary"),
    vcardUid: parsed.uid,
    rawVcard: vcard,
    sourceType: "vcard",
  });
}

export function buildVCardForContact(contact: DbContact, identities: ContactIdentity[]): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  if (contact.vcard_uid) lines.push(`UID:${escapeVCardValue(contact.vcard_uid)}`);
  lines.push(`FN:${escapeVCardValue(contact.display_name ?? contact.email)}`);
  if (contact.first_name || contact.last_name) {
    lines.push(`N:${escapeVCardValue(contact.last_name ?? "")};${escapeVCardValue(contact.first_name ?? "")};;;`);
  }
  if (contact.nickname) lines.push(`NICKNAME:${escapeVCardValue(contact.nickname)}`);
  for (const identity of identities) {
    const labels = [identity.label, identity.is_primary === 1 ? "PREF" : "INTERNET"].filter(Boolean);
    const type = labels.join(",");
    lines.push(`EMAIL;TYPE=${type}:${escapeVCardValue(identity.email)}`);
  }
  if (contact.timezone) lines.push(`TZ:${escapeVCardValue(contact.timezone)}`);
  if (contact.notes) lines.push(`NOTE:${escapeVCardValue(contact.notes)}`);
  if (contact.organization) lines.push(`ORG:${escapeVCardValue(contact.organization)}`);
  if (contact.title) lines.push(`TITLE:${escapeVCardValue(contact.title)}`);
  if (contact.role) lines.push(`ROLE:${escapeVCardValue(contact.role)}`);
  if (contact.birthday) lines.push(`BDAY:${escapeVCardValue(contact.birthday)}`);
  if (contact.anniversary) lines.push(`ANNIVERSARY:${escapeVCardValue(contact.anniversary)}`);
  lines.push("END:VCARD");
  return `${lines.join("\r\n")}\r\n`;
}

export function buildVCardForRichContact(contact: RichContact): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  lines.push(`UID:${escapeVCardValue(contact.vcard_uid ?? contact.remote_uid ?? contact.id)}`);
  lines.push(`FN:${escapeVCardValue(contact.display_name ?? contact.email)}`);
  if (contact.first_name || contact.last_name) {
    lines.push(`N:${escapeVCardValue(contact.last_name ?? "")};${escapeVCardValue(contact.first_name ?? "")};;;`);
  }
  if (contact.nickname) lines.push(`NICKNAME:${escapeVCardValue(contact.nickname)}`);

  for (const method of contact.methods) {
    const label = method.label ? `;TYPE=${escapeVCardValue(method.label)}` : "";
    const pref = method.is_primary === 1 ? `${label ? "," : ";TYPE="}PREF` : "";
    if (method.kind === "email") lines.push(`EMAIL${label}${pref}:${escapeVCardValue(method.value)}`);
    if (method.kind === "phone") lines.push(`TEL${label}${pref}:${escapeVCardValue(method.value)}`);
    if (method.kind === "url") lines.push(`URL${label}${pref}:${escapeVCardValue(method.value)}`);
    if (method.kind === "impp") lines.push(`IMPP${label}:${escapeVCardValue(method.value)}`);
  }

  for (const address of contact.addresses) {
    const label = address.label ? `;TYPE=${escapeVCardValue(address.label)}` : "";
    lines.push([
      `ADR${label}:`,
      "",
      "",
      escapeVCardValue(address.street ?? ""),
      escapeVCardValue(address.city ?? ""),
      escapeVCardValue(address.region ?? ""),
      escapeVCardValue(address.postal_code ?? ""),
      escapeVCardValue(address.country ?? ""),
    ].join(";"));
  }

  for (const date of contact.specialDates) {
    if (date.kind === "birthday") lines.push(`BDAY:${escapeVCardValue(date.value)}`);
    else if (date.kind === "anniversary") lines.push(`ANNIVERSARY:${escapeVCardValue(date.value)}`);
    else lines.push(`X-ABDATE;TYPE=${escapeVCardValue(date.label ?? "custom")}:${escapeVCardValue(date.value)}`);
  }

  if (contact.timezone) lines.push(`TZ:${escapeVCardValue(contact.timezone)}`);
  if (contact.organization) lines.push(`ORG:${escapeVCardValue(contact.organization)}`);
  if (contact.title) lines.push(`TITLE:${escapeVCardValue(contact.title)}`);
  if (contact.role) lines.push(`ROLE:${escapeVCardValue(contact.role)}`);
  if (contact.notes) lines.push(`NOTE:${escapeVCardValue(contact.notes)}`);
  lines.push("END:VCARD");
  return `${lines.join("\r\n")}\r\n`;
}

export async function exportContactToVCard(contactId: string): Promise<string | null> {
  const contact = await selectFirstBy<DbContact>(
    "SELECT * FROM contacts WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
    [contactId],
  );
  if (!contact) return null;
  const identities = await getContactIdentities(contactId);
  const rich = await getRichContact(contactId);
  if (rich) return buildVCardForRichContact(rich);
  return buildVCardForContact(contact, identities);
}
