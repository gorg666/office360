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
  emails: string[];
  notes: string | null;
  organization: string | null;
  title: string | null;
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
    return;
  }

  const id = crypto.randomUUID();
  await withTransaction(async (lockedDb) => {
    await lockedDb.execute(
      `INSERT INTO contacts (
         id, email, display_name, contact_type, user_edited, source_type, last_contacted_at
       )
       VALUES ($1, $2, $3, 'inferred', 0, 'inferred', unixepoch())`,
      [id, normalized, displayName],
    );
    await lockedDb.execute(
      `INSERT INTO contact_identities (
         id, contact_id, email, display_name, is_primary, source_type
       )
       VALUES ($1, $2, $3, $4, 1, 'inferred')`,
      [crypto.randomUUID(), id, normalized, displayName],
    );
  });
}

export async function saveManagedContact(input: SaveManagedContactInput): Promise<ManagedContact> {
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
             source_type = $9,
             updated_at = unixepoch()
         WHERE id = $10`,
        [
          primaryEmail,
          input.displayName,
          notesProvided,
          input.notes ?? null,
          input.vcardUid ?? null,
          input.rawVcard ?? null,
          input.organization ?? null,
          input.title ?? null,
          sourceType,
          id,
        ],
      );
    } else {
      await lockedDb.execute(
        `INSERT INTO contacts (
           id, email, display_name, notes, contact_type, user_edited,
           vcard_uid, vcard_raw, organization, title, source_type
         )
         VALUES ($1, $2, $3, $4, 'managed', 1, $5, $6, $7, $8, $9)`,
        [
          id,
          primaryEmail,
          input.displayName,
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
  avatarUrl: string,
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
  let uid: string | null = null;
  let displayName: string | null = null;
  let notes: string | null = null;
  let organization: string | null = null;
  let title: string | null = null;

  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).split(";")[0]!.toUpperCase();
    const value = unescapeVCardValue(line.slice(separator + 1).trim());
    if (key === "UID") uid = value || null;
    if (key === "FN") displayName = value || null;
    if (key === "EMAIL") {
      const normalized = normalizeEmail(value);
      if (normalized && !emails.includes(normalized)) emails.push(normalized);
    }
    if (key === "NOTE") notes = value || null;
    if (key === "ORG") organization = value || null;
    if (key === "TITLE") title = value || null;
  }

  return {
    uid,
    displayName,
    emails,
    notes,
    organization,
    title,
  };
}

export async function importVCard(vcard: string): Promise<ManagedContact> {
  const parsed = parseVCard(vcard);
  if (parsed.emails.length === 0) {
    throw new Error("vCard import requires at least one EMAIL field");
  }

  return saveManagedContact({
    displayName: parsed.displayName,
    identities: parsed.emails,
    primaryEmail: parsed.emails[0] ?? null,
    notes: parsed.notes,
    organization: parsed.organization,
    title: parsed.title,
    vcardUid: parsed.uid,
    rawVcard: vcard,
    sourceType: "vcard",
  });
}

export function buildVCardForContact(contact: DbContact, identities: ContactIdentity[]): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  if (contact.vcard_uid) lines.push(`UID:${escapeVCardValue(contact.vcard_uid)}`);
  lines.push(`FN:${escapeVCardValue(contact.display_name ?? contact.email)}`);
  for (const identity of identities) {
    const type = identity.is_primary === 1 ? "PREF" : "INTERNET";
    lines.push(`EMAIL;TYPE=${type}:${escapeVCardValue(identity.email)}`);
  }
  if (contact.notes) lines.push(`NOTE:${escapeVCardValue(contact.notes)}`);
  if (contact.organization) lines.push(`ORG:${escapeVCardValue(contact.organization)}`);
  if (contact.title) lines.push(`TITLE:${escapeVCardValue(contact.title)}`);
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
  return buildVCardForContact(contact, identities);
}
