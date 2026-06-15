import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { DAVClient, type DAVAddressBook, type DAVVCard } from "tsdav";
import { getSecureSetting } from "@/services/db/settings";
import { getDb } from "@/services/db/connection";
import {
  buildVCardForRichContact,
  getContactDirectories,
  getRichContact,
  parseVCard,
  saveRichContact,
  type ContactDirectory,
} from "@/services/db/contacts";

export interface CardDavConnectionResult {
  success: boolean;
  message: string;
  addressBookCount?: number;
  addressBooks?: { url: string; displayName: string }[];
}

export interface CardDavSyncResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export async function discoverCardDavUrl(emailOrDomain: string): Promise<string | null> {
  const domain = emailOrDomain.includes("@")
    ? emailOrDomain.split("@")[1]?.toLowerCase()
    : emailOrDomain.toLowerCase();
  if (!domain) return null;

  const wellKnown = `https://${domain}/.well-known/carddav`;
  try {
    const response = await fetch(wellKnown, { method: "GET", redirect: "manual" });
    if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
      const location = response.headers.get("Location");
      if (!location) return wellKnown;
      return location.startsWith("/") ? `https://${domain}${location}` : location;
    }
    if (response.ok || response.status === 401) return wellKnown;
  } catch {
    // Most providers either redirect or reject unauthenticated well-known requests.
  }

  const nextcloud = `https://${domain}/remote.php/dav/`;
  try {
    const response = await fetch(nextcloud, { method: "OPTIONS" });
    if (response.ok || response.status === 401) return nextcloud;
  } catch {
    // Not a Nextcloud-style endpoint.
  }

  return null;
}

async function getCardDavPassword(directory: ContactDirectory): Promise<string> {
  if (!directory.auth_ref) {
    throw new Error("CardDAV password is not configured");
  }
  const password = await getSecureSetting(directory.auth_ref);
  if (!password) {
    throw new Error("CardDAV password is not configured");
  }
  return password;
}

async function createClient(directory: ContactDirectory): Promise<DAVClient> {
  if (!directory.server_url) throw new Error("CardDAV server URL is not configured");
  if (!directory.username) throw new Error("CardDAV username is not configured");
  const password = await getCardDavPassword(directory);

  const client = new DAVClient({
    serverUrl: directory.server_url,
    credentials: { username: directory.username, password },
    authMethod: "Basic",
    defaultAccountType: "carddav",
    fetch: tauriFetch,
  });
  await client.login();
  return client;
}

async function getDirectory(directoryId: string): Promise<ContactDirectory> {
  const directory = (await getContactDirectories()).find((item) => item.id === directoryId);
  if (!directory) throw new Error("Address book directory not found");
  if (directory.kind !== "carddav") throw new Error("Directory is not CardDAV-backed");
  return directory;
}

function getAddressBookDisplayName(book: DAVAddressBook, index: number): string {
  return typeof book.displayName === "string" && book.displayName.trim()
    ? book.displayName
    : `Address Book ${index + 1}`;
}

export async function testCardDavDirectory(directoryId: string): Promise<CardDavConnectionResult> {
  try {
    const directory = await getDirectory(directoryId);
    const client = await createClient(directory);
    const addressBooks = await client.fetchAddressBooks();
    return {
      success: true,
      message: `Connected - found ${addressBooks.length} address book${addressBooks.length === 1 ? "" : "s"}`,
      addressBookCount: addressBooks.length,
      addressBooks: addressBooks.map((book, index) => ({
        url: book.url,
        displayName: getAddressBookDisplayName(book as DAVAddressBook, index),
      })),
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? sanitizeDavError(err.message) : "CardDAV connection failed",
    };
  }
}

export async function syncCardDavDirectory(directoryId: string): Promise<CardDavSyncResult> {
  const db = await getDb();
  const directory = await getDirectory(directoryId);
  const result: CardDavSyncResult = { imported: 0, skipped: 0, errors: [] };

  try {
    await db.execute(
      "UPDATE contact_directories SET sync_status = 'syncing', sync_error = NULL, updated_at = unixepoch() WHERE id = $1",
      [directoryId],
    );

    const client = await createClient(directory);
    const books = await client.fetchAddressBooks();
    const addressBook = pickAddressBook(books as DAVAddressBook[], directory.remote_url);
    if (!addressBook) throw new Error("No CardDAV address book found");
    const cards = await client.fetchVCards({ addressBook });

    for (const card of cards as DAVVCard[]) {
      if (!card.data) {
        result.skipped += 1;
        continue;
      }
      try {
        const parsed = parseVCard(String(card.data));
        if (parsed.emails.length === 0) {
          result.skipped += 1;
          continue;
        }
        await saveRichContact({
          directoryId,
          displayName: parsed.displayName,
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          nickname: parsed.nickname,
          identities: parsed.emails.map((email, index) => ({
            email,
            label: parsed.emailLabels.get(email) ?? null,
            isPrimary: index === 0,
          })),
          primaryEmail: parsed.emails[0] ?? null,
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
          rawVcard: String(card.data),
          sourceType: "carddav",
          remoteUrl: card.url,
          remoteUid: parsed.uid,
          syncEtag: card.etag ?? null,
          syncStatus: "synced",
        });
        result.imported += 1;
      } catch (err) {
        result.errors.push(err instanceof Error ? sanitizeDavError(err.message) : "Failed to import vCard");
      }
    }

    await db.execute(
      `UPDATE contact_directories
       SET sync_status = $1,
           sync_error = $2,
           remote_url = COALESCE(remote_url, $3),
           ctag = $4,
           sync_token = $5,
           last_synced_at = unixepoch(),
           updated_at = unixepoch()
       WHERE id = $6`,
      [
        result.errors.length > 0 ? "error" : "synced",
        result.errors[0] ?? null,
        addressBook.url,
        addressBook.ctag ?? null,
        addressBook.syncToken ?? null,
        directoryId,
      ],
    );
  } catch (err) {
    const message = err instanceof Error ? sanitizeDavError(err.message) : "CardDAV sync failed";
    await db.execute(
      "UPDATE contact_directories SET sync_status = 'error', sync_error = $1, updated_at = unixepoch() WHERE id = $2",
      [message, directoryId],
    );
    result.errors.push(message);
  }

  return result;
}

export async function pushRichContactToCardDav(contactId: string): Promise<void> {
  const contact = await getRichContact(contactId);
  if (!contact?.directory || contact.directory.kind !== "carddav") {
    throw new Error("Contact is not in a CardDAV address book");
  }
  const client = await createClient(contact.directory);
  const books = await client.fetchAddressBooks();
  const addressBook = pickAddressBook(books as DAVAddressBook[], contact.directory.remote_url);
  if (!addressBook) throw new Error("No CardDAV address book found");
  const vCardString = buildVCardForRichContact(contact);

  if (contact.remote_url) {
    const response = await client.updateVCard({
      vCard: {
        url: contact.remote_url,
        etag: contact.sync_etag ?? undefined,
        data: vCardString,
      },
      headers: contact.sync_etag ? { "If-Match": contact.sync_etag } : undefined,
    });
    await assertResponseOk(response, "update vCard");
    return;
  }

  const filename = `${contact.vcard_uid ?? contact.id}.vcf`;
  const response = await client.createVCard({ addressBook, filename, vCardString });
  await assertResponseOk(response, "create vCard");
}

function pickAddressBook(books: DAVAddressBook[], remoteUrl: string | null): DAVAddressBook | null {
  if (remoteUrl) {
    const found = books.find((book) => book.url === remoteUrl);
    if (found) return found;
  }
  return books[0] ?? null;
}

async function assertResponseOk(response: Response, action: string): Promise<void> {
  if (response.ok) return;
  throw new Error(`CardDAV ${action} failed (${response.status}): ${response.statusText}`);
}

function sanitizeDavError(message: string): string {
  return message
    .replace(/Authorization:\s*[^,\n]+/gi, "Authorization: [redacted]")
    .replace(/password[=:]\s*[^,\n]+/gi, "password=[redacted]")
    .slice(0, 500);
}
