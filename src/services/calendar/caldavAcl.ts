import type { DAVClient } from "tsdav";
import {
  CalendarAclError,
  participantRefFromEmail,
  participantRefFromUri,
  type CalendarAclCapabilities,
  type CalendarShareEntry,
  type CalendarShareRole,
} from "./domain";

const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";

interface DavAceSnapshot {
  entry: CalendarShareEntry;
  principalHref: string;
  xml: string;
}

export interface DavAclSnapshot {
  capabilities: CalendarAclCapabilities;
  entries: CalendarShareEntry[];
  aces: DavAceSnapshot[];
  rawAceXml: string[];
  principalCollections: string[];
}

export async function discoverDavAcl(
  client: DAVClient,
  calendarUrl: string,
  currentPrincipalUrl: string | null,
): Promise<DavAclSnapshot> {
  const options = await davFetch(client, calendarUrl, { method: "OPTIONS" });
  if (options.status === 403) return emptySnapshot("permission-denied", "options-permission-denied");
  if (!options.ok) return emptySnapshot("unsupported", `options-${options.status}`);

  const response = await davFetch(client, calendarUrl, {
    method: "PROPFIND",
    headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
    body: `<?xml version="1.0" encoding="utf-8"?>
      <D:propfind xmlns:D="DAV:"><D:prop>
        <D:owner/><D:current-user-privilege-set/><D:supported-privilege-set/>
        <D:acl/><D:acl-restrictions/><D:principal-collection-set/>
      </D:prop></D:propfind>`,
  });
  if (response.status === 403) return emptySnapshot("permission-denied", "acl-property-permission-denied");
  if (!response.ok) return emptySnapshot("unsupported", `propfind-${response.status}`);
  const document = parseXml(await response.text());
  const prop = successfulProp(document);
  if (!prop) return emptySnapshot("unsupported", "acl-properties-missing");

  const privileges = privilegeNames(firstChild(prop, "current-user-privilege-set"));
  const acl = firstChild(prop, "acl");
  const ownerHref = hrefValue(firstChild(prop, "owner"), calendarUrl);
  const principalCollections = childElements(firstChild(prop, "principal-collection-set"), "href")
    .map((element) => resolveHref(element.textContent, calendarUrl)).filter(isString);
  const davHeader = options.headers.get("DAV") ?? "";
  const allowHeader = options.headers.get("Allow") ?? "";
  const hasReadAcl = privileges.has("read-acl");
  const hasWriteAcl = privileges.has("write-acl");
  const aclMethod = tokenContains(allowHeader, "ACL") && tokenContains(davHeader, "access-control");
  const read = hasReadAcl && !!acl ? "supported" as const : "unsupported" as const;
  const write = read === "supported" && hasWriteAcl && aclMethod && principalCollections.length > 0
    ? "supported" as const : "unsupported" as const;
  const aces = acl ? parseAces(acl, calendarUrl, ownerHref, currentPrincipalUrl) : [];
  return {
    capabilities: {
      read,
      write,
      reason: read !== "supported" ? "read-acl-not-confirmed"
        : write !== "supported" ? "write-acl-contract-incomplete" : null,
    },
    entries: aces.map((ace) => ace.entry),
    aces,
    rawAceXml: acl ? childElements(acl, "ace").map((ace) => new XMLSerializer().serializeToString(ace)) : [],
    principalCollections,
  };
}

export async function grantDavShare(
  client: DAVClient,
  calendarUrl: string,
  currentPrincipalUrl: string | null,
  email: string,
  role: CalendarShareRole,
): Promise<CalendarShareEntry> {
  const snapshot = await discoverDavAcl(client, calendarUrl, currentPrincipalUrl);
  assertDavWrite(snapshot);
  const principalHref = await resolveDavPrincipal(client, snapshot.principalCollections, email);
  if (snapshot.aces.some((ace) => sameHref(ace.principalHref, principalHref))) {
    throw new CalendarAclError("duplicate-principal", "This person already has calendar access.");
  }
  const entry = davEntry(principalHref, role, calendarUrl, null, currentPrincipalUrl, false);
  await writeAcl(client, calendarUrl, [...snapshot.rawAceXml, aceXml(principalHref, role)]);
  return {
    ...entry,
    participant: participantRefFromEmail(email),
    principalType: "user",
    principalValue: email,
  };
}

export async function updateDavShare(
  client: DAVClient,
  calendarUrl: string,
  currentPrincipalUrl: string | null,
  entryId: string,
  role: CalendarShareRole,
): Promise<CalendarShareEntry> {
  const snapshot = await discoverDavAcl(client, calendarUrl, currentPrincipalUrl);
  assertDavWrite(snapshot);
  const index = snapshot.aces.findIndex((ace) => ace.entry.id === entryId);
  if (index < 0) throw new CalendarAclError("entry-not-found", "Sharing entry no longer exists.", entryId);
  assertMutable(snapshot.aces[index]!.entry);
  const targetXml = snapshot.aces[index]!.xml;
  const next = snapshot.rawAceXml.map((xml) => xml === targetXml ? aceXml(snapshot.aces[index]!.principalHref, role) : xml);
  await writeAcl(client, calendarUrl, next);
  return davEntry(snapshot.aces[index]!.principalHref, role, calendarUrl, null, currentPrincipalUrl, false);
}

export async function revokeDavShare(
  client: DAVClient,
  calendarUrl: string,
  currentPrincipalUrl: string | null,
  entryId: string,
): Promise<void> {
  const snapshot = await discoverDavAcl(client, calendarUrl, currentPrincipalUrl);
  assertDavWrite(snapshot);
  const ace = snapshot.aces.find((candidate) => candidate.entry.id === entryId);
  if (!ace) throw new CalendarAclError("entry-not-found", "Sharing entry no longer exists.", entryId);
  assertMutable(ace.entry);
  await writeAcl(client, calendarUrl, snapshot.rawAceXml.filter((xml) => xml !== ace.xml));
}

async function resolveDavPrincipal(client: DAVClient, collections: readonly string[], email: string): Promise<string> {
  for (const collection of collections) {
    const response = await davFetch(client, collection, {
      method: "REPORT",
      headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="utf-8"?>
        <D:principal-property-search xmlns:D="DAV:" xmlns:C="${CALDAV_NS}">
          <D:property-search><D:prop><C:calendar-user-address-set/></D:prop>
            <D:match>mailto:${escapeXml(email)}</D:match></D:property-search>
          <D:prop><D:displayname/><C:calendar-user-address-set/></D:prop>
        </D:principal-property-search>`,
    });
    if (!response.ok) continue;
    const document = parseXml(await response.text());
    for (const davResponse of elements(document, "response")) {
      const addresses = elements(davResponse, "calendar-user-address-set")
        .flatMap((element) => childElements(element, "href"))
        .map((element) => element.textContent?.trim().replace(/^mailto:/i, "").toLowerCase());
      if (!addresses.includes(email.toLowerCase())) continue;
      const href = firstDescendant(davResponse, "href")?.textContent;
      const resolved = resolveHref(href, collection);
      if (resolved) return resolved;
    }
  }
  throw new CalendarAclError("invalid-principal", "The CalDAV server could not resolve this email to a principal.");
}

async function writeAcl(client: DAVClient, calendarUrl: string, aceFragments: readonly string[]): Promise<void> {
  const response = await davFetch(client, calendarUrl, {
    method: "ACL",
    headers: { "Content-Type": "application/xml; charset=utf-8" },
    body: `<?xml version="1.0" encoding="utf-8"?><D:acl xmlns:D="DAV:" xmlns:C="${CALDAV_NS}">${aceFragments.join("")}</D:acl>`,
  });
  if (response.status === 403) throw new CalendarAclError("permission-denied", "The CalDAV server denied the ACL change.");
  if (!response.ok) throw new CalendarAclError("provider-error", `CalDAV ACL request failed (${response.status}).`);
}

function parseAces(
  acl: Element,
  calendarUrl: string,
  ownerHref: string | null,
  currentPrincipalUrl: string | null,
): DavAceSnapshot[] {
  return childElements(acl, "ace").flatMap((ace) => {
    const principal = firstChild(ace, "principal");
    const href = hrefValue(principal, calendarUrl);
    const grant = firstChild(ace, "grant");
    if (!href || !grant) return [];
    const role = roleFromPrivileges(privilegeNames(grant));
    if (!role) return [];
    const isProtected = !!firstChild(ace, "protected") || !!firstChild(ace, "inherited");
    return [{
      entry: davEntry(href, role, calendarUrl, ownerHref, currentPrincipalUrl, isProtected),
      principalHref: href,
      xml: new XMLSerializer().serializeToString(ace),
    }];
  });
}

function davEntry(
  href: string,
  role: CalendarShareRole,
  calendarUrl: string,
  ownerHref: string | null,
  currentPrincipalUrl: string | null,
  protectedByServer: boolean,
): CalendarShareEntry {
  const mail = /^mailto:/i.test(href) ? href.replace(/^mailto:/i, "") : null;
  const participant = mail ? participantRefFromEmail(mail) : participantRefFromUri(href);
  const isOwner = !!ownerHref && sameHref(href, ownerHref) || role === "owner";
  const isCurrentUser = !!currentPrincipalUrl && sameHref(href, resolveHref(currentPrincipalUrl, calendarUrl) ?? currentPrincipalUrl);
  return {
    id: `dav:${encodeURIComponent(href)}`,
    participant,
    principalType: "user",
    principalValue: mail ?? href,
    displayName: null,
    role: isOwner ? "owner" : role,
    isCurrentUser,
    isOwner,
    isProtected: protectedByServer || isOwner || isCurrentUser,
  };
}

function roleFromPrivileges(privileges: ReadonlySet<string>): CalendarShareRole | null {
  if (privileges.has("write-acl")) return "owner";
  if (privileges.has("write") || privileges.has("write-content") || privileges.has("bind") || privileges.has("unbind")) return "writer";
  if (privileges.has("read")) return "reader";
  if (privileges.has("read-free-busy")) return "free-busy-only";
  return null;
}

function aceXml(principalHref: string, role: CalendarShareRole): string {
  if (role === "owner") throw new CalendarAclError("owner-protected", "Ownership transfer is not supported by this flow.");
  const privileges = role === "writer" ? "<D:privilege><D:read/></D:privilege><D:privilege><D:write/></D:privilege>"
    : role === "reader" ? "<D:privilege><D:read/></D:privilege>"
      : "<D:privilege><C:read-free-busy/></D:privilege>";
  return `<D:ace><D:principal><D:href>${escapeXml(principalHref)}</D:href></D:principal><D:grant>${privileges}</D:grant></D:ace>`;
}

function assertDavWrite(snapshot: DavAclSnapshot): void {
  if (snapshot.capabilities.write !== "supported") {
    throw new CalendarAclError("unsupported", "The server did not expose a complete RFC 3744 ACL write contract.");
  }
}

function assertMutable(entry: CalendarShareEntry): void {
  if (entry.isOwner) throw new CalendarAclError("owner-protected", "Owner access cannot be changed.", entry.id);
  if (entry.isCurrentUser) throw new CalendarAclError("current-user-protected", "Your own access cannot be changed here.", entry.id);
  if (entry.isProtected) throw new CalendarAclError("owner-protected", "Protected DAV access cannot be changed.", entry.id);
}

async function davFetch(client: DAVClient, url: string, init: RequestInit): Promise<Response> {
  const fetcher = client.fetchOverride ?? globalThis.fetch;
  return fetcher(url, { ...init, headers: { ...client.authHeaders, ...init.headers } });
}

function successfulProp(document: Document): Element | null {
  for (const propstat of elements(document, "propstat")) {
    const status = firstChild(propstat, "status")?.textContent ?? "";
    if (/\s2\d\d\s/.test(status)) return firstChild(propstat, "prop");
  }
  return null;
}

function privilegeNames(root: Element | null): Set<string> {
  const names = new Set<string>();
  if (!root) return names;
  for (const privilege of elements(root, "privilege")) {
    const name = [...privilege.children][0]?.localName?.toLowerCase();
    if (name) names.add(name);
  }
  return names;
}

function emptySnapshot(support: CalendarAclCapabilities["read"], reason: string): DavAclSnapshot {
  return { capabilities: { read: support, write: support, reason }, entries: [], aces: [], rawAceXml: [], principalCollections: [] };
}

function parseXml(xml: string): Document {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new CalendarAclError("provider-error", "The CalDAV server returned malformed ACL XML.");
  }
  return document;
}

function elements(root: Document | Element, localName: string): Element[] {
  return [...root.getElementsByTagNameNS("*", localName)];
}

function childElements(root: Element | null, localName: string): Element[] {
  return root ? [...root.children].filter((child) => child.localName === localName) : [];
}

function firstChild(root: Element | null, localName: string): Element | null {
  return childElements(root, localName)[0] ?? null;
}

function firstDescendant(root: Element, localName: string): Element | null {
  return elements(root, localName)[0] ?? null;
}

function hrefValue(root: Element | null, base: string): string | null {
  if (!root) return null;
  return resolveHref(firstDescendant(root, "href")?.textContent, base);
}

function resolveHref(value: string | null | undefined, base: string): string | null {
  const href = value?.trim();
  if (!href) return null;
  if (/^mailto:/i.test(href)) return href;
  try { return new URL(href, base).href; } catch { return null; }
}

function sameHref(a: string, b: string): boolean {
  return a.replace(/\/$/, "").toLowerCase() === b.replace(/\/$/, "").toLowerCase();
}

function tokenContains(header: string, token: string): boolean {
  return header.split(/[,\s]+/).some((value) => value.trim().toLowerCase() === token.toLowerCase());
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function isString(value: string | null): value is string {
  return value !== null;
}
