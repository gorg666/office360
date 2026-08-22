import { DAVClient, type DAVCalendar, type DAVObject } from "tsdav";
import type {
  CalendarProvider,
  CalendarProviderType,
  CalendarInfo,
  CalendarEventData,
  CalendarSyncResult,
  CreateEventInput,
  UpdateEventInput,
  CalendarParticipationStatus,
  CalendarReadDiagnostics,
  RecurringMutationContext,
} from "./types";
import { collectDavPrivilegeNames, davCalendarAccess, type CalendarProviderCapabilities } from "./domain";
import { excludeVEventOccurrence, generateVEvent, parseVEvent, parseVEventsInRangeDetailed, updateAttendeeParticipation, updateVEventFields, updateVEventOccurrence } from "./icalHelper";
import { getAccount, type DbAccount } from "@/services/db/accounts";
import { ensureFreshToken, OAUTH_TOKEN_REFRESH_BUFFER_MS } from "@/services/oauth/oauthTokenManager";
import { isYandexOAuthCalendarAccount, YANDEX_CALDAV_URL } from "./yandex";
import { clearAccountDiagnostic, upsertAccountDiagnostic } from "@/services/db/accountDiagnostics";
import { createConnectionDiagnostic, redactLogIdentifier } from "@/services/diagnostics";
import { calDavSessionFetch, isCalDavAuthFailure } from "./caldavAuthFailure";
import { decodeVFreeBusy, encodeVFreeBusyRequest } from "./ical/freeBusyCodec";
import type { BusyInterval } from "./freeBusy/types";

export { isCalDavAuthFailure } from "./caldavAuthFailure";

type CalDavAuthKind = "basic" | "yandex_oauth";

interface CalDavCredentialState {
  authKind: CalDavAuthKind;
  serverUrl: string;
  username: string;
  credentialValue: string;
  expiresAtMs: number | null;
}

interface CalDavProviderSession {
  client: DAVClient;
  credential: CalDavCredentialState;
  invalidated: boolean;
}

interface GetSessionOptions {
  forceCredentialRefresh?: boolean;
  reason?: string;
}

export interface CalDavFreeBusyDiscovery {
  supported: boolean;
  autoSchedule: boolean;
  scheduleInboxUrl: string | null;
  scheduleOutboxUrl: string | null;
  calendarUserAddresses: string[];
  reason: "supported" | "missing-principal" | "missing-outbox" | "missing-user-address" | "missing-auto-schedule" | "yandex-unconfirmed" | "error";
}

export interface CalDavRemoteFreeBusyResult {
  recipient: string;
  status: "known" | "permission-denied" | "error";
  busy: BusyInterval[];
}

export class CalDAVProvider implements CalendarProvider {
  readonly type: CalendarProviderType = "caldav";
  private remoteFreeBusyCapability: "none" | "remote" = "none";
  get capabilities(): CalendarProviderCapabilities {
    return {
      version: 5,
      read: { calendars: "full", events: "full" },
      events: { create: "remote", update: "remote", delete: "remote" },
      recurrence: {
        read: "full",
        write: "partial",
        updateScopes: ["single", "series"],
        deleteScopes: ["single", "series"],
      },
      attendees: { read: "partial", write: "partial" },
      rsvp: { local: "projection", remote: "direct" },
      invitations: "none",
      sync: { mode: "range-refresh", pagination: false, durability: "ephemeral" },
      freeBusy: { self: "local-derived", others: this.remoteFreeBusyCapability },
      permissions: "none",
      sharedCalendars: "read",
      calendarAccess: { discovery: "full", ownership: "partial", effectivePermissions: "partial", aclRead: "partial", aclWrite: "none" },
      reminders: {
        read: "partial",
        write: "partial",
        multiple: true,
        methods: ["notification"],
        defaults: "none",
        maxCount: null,
      },
      conflictDetection: "etag",
    };
  }
  private _lastReadDiagnostics: CalendarReadDiagnostics = emptyReadDiagnostics();

  get lastReadDiagnostics(): CalendarReadDiagnostics {
    return this._lastReadDiagnostics;
  }
  private readonly sessionKey: string;
  private session: CalDavProviderSession | null = null;
  private sessionCreation: Promise<CalDavProviderSession> | null = null;
  private recreationPending = false;
  private forceCredentialRefreshRequired = false;
  private freeBusyDiscovery: Promise<CalDavFreeBusyDiscovery> | null = null;

  constructor(readonly accountId: string) {
    this.sessionKey = `caldav:${accountId}`;
  }

  private async getSession(options: GetSessionOptions = {}): Promise<CalDavProviderSession> {
    if (this.sessionCreation) {
      this.logSessionDiagnostic("session_creation_reused", { reason: options.reason ?? "concurrent_request" });
      return this.sessionCreation;
    }

    const account = await getAccount(this.accountId);
    if (!account) throw new Error("Account not found");

    if (this.sessionCreation) {
      this.logSessionDiagnostic("session_creation_reused", { reason: options.reason ?? "concurrent_request" });
      return this.sessionCreation;
    }

    const forceCredentialRefresh =
      options.forceCredentialRefresh === true || this.forceCredentialRefreshRequired;
    if (!forceCredentialRefresh && this.session) {
      const staleReason = getSessionStaleReason(this.session, account);
      if (!staleReason) {
        this.logSessionDiagnostic("session_cache_hit");
        return this.session;
      }
      this.invalidateSession(this.session, staleReason);
    }

    const isRecreation = this.recreationPending;
    this.logSessionDiagnostic("session_creation_started", {
      reason: options.reason ?? (isRecreation ? "stale_or_invalidated" : "cache_miss"),
      forceCredentialRefresh,
    });

    const creation = this.createSession(account, forceCredentialRefresh).then((session) => {
      this.session = session;
      this.recreationPending = false;
      this.forceCredentialRefreshRequired = false;
      if (isRecreation) this.logSessionDiagnostic("session_recreated");
      return session;
    });
    this.sessionCreation = creation;

    try {
      return await creation;
    } finally {
      if (this.sessionCreation === creation) this.sessionCreation = null;
    }
  }

  private async createSession(
    account: DbAccount,
    forceCredentialRefresh: boolean,
  ): Promise<CalDavProviderSession> {
    const usesYandexOAuth = isYandexOAuthCalendarAccount(account);
    const serverUrl = account.caldav_url ?? (usesYandexOAuth ? YANDEX_CALDAV_URL : null);
    const username = account.caldav_username ?? account.email;
    const password = account.caldav_password;

    if (!serverUrl) {
      throw new Error("CalDAV credentials not configured");
    }

    let client: DAVClient;

    if (usesYandexOAuth) {
      const accessToken = forceCredentialRefresh
        ? await ensureFreshToken(account, { forceRefresh: true })
        : await ensureFreshToken(account);
      const { loginYandexCalDavClient } = await import("./yandexCalDavAuth");
      client = await loginYandexCalDavClient(serverUrl, accessToken, calDavSessionFetch);
      return {
        client,
        credential: {
          authKind: "yandex_oauth",
          serverUrl,
          username,
          credentialValue: accessToken,
          expiresAtMs: account.token_expires_at ? account.token_expires_at * 1000 : null,
        },
        invalidated: false,
      };
    } else {
      if (!password) {
        throw new Error("CalDAV credentials not configured");
      }

      client = new DAVClient({
        serverUrl,
        credentials: { username, password },
        authMethod: "Basic",
        defaultAccountType: "caldav",
        fetch: calDavSessionFetch,
      });
      await client.login();
      return {
        client,
        credential: {
          authKind: "basic",
          serverUrl,
          username,
          credentialValue: password,
          expiresAtMs: null,
        },
        invalidated: false,
      };
    }
  }

  private invalidateSession(session: CalDavProviderSession, reason: string): void {
    if (session.invalidated) return;
    session.invalidated = true;
    if (this.session === session) this.session = null;
    this.recreationPending = true;
    if (reason === "auth_failure") this.forceCredentialRefreshRequired = true;
    this.logSessionDiagnostic("session_invalidated", { reason });
  }

  private async withClient<T>(operation: string, run: (client: DAVClient) => Promise<T>): Promise<T> {
    const session = await this.getSession({ reason: operation });
    try {
      return await run(session.client);
    } catch (error) {
      if (!isCalDavAuthFailure(error)) throw error;

      this.invalidateSession(session, "auth_failure");
      const retrySession = await this.getSession({
        forceCredentialRefresh: true,
        reason: `${operation}_auth_retry`,
      });
      try {
        return await run(retrySession.client);
      } catch (retryError) {
        if (isCalDavAuthFailure(retryError)) {
          this.invalidateSession(retrySession, "auth_failure");
        }
        throw retryError;
      }
    }
  }

  private logSessionDiagnostic(event: string, details: Record<string, unknown> = {}): void {
    const redactedAccountId = redactLogIdentifier(this.sessionKey.slice("caldav:".length));
    console.info("[calendar-session]", {
      event,
      provider: "caldav",
      accountId: redactedAccountId,
      sessionKey: `caldav:${redactedAccountId}`,
      ...details,
    });
  }

  /** Read-only RFC 6638 discovery. Yandex remains disabled until its CalDAV endpoint is proven. */
  discoverRemoteFreeBusy(signal?: AbortSignal): Promise<CalDavFreeBusyDiscovery> {
    if (this.freeBusyDiscovery) return this.freeBusyDiscovery;
    const discovery = this.discoverRemoteFreeBusyOnce(signal);
    this.freeBusyDiscovery = discovery;
    discovery.catch(() => {
      if (this.freeBusyDiscovery === discovery) this.freeBusyDiscovery = null;
    });
    return discovery;
  }

  private async discoverRemoteFreeBusyOnce(signal?: AbortSignal): Promise<CalDavFreeBusyDiscovery> {
    const account = await getAccount(this.accountId);
    if (!account) return emptyFreeBusyDiscovery("error");
    const isYandex = isYandexOAuthCalendarAccount(account);
    const discovery = await this.withClient("free_busy_discovery", async (client) => {
      const principalUrl = client.account?.principalUrl;
      if (!principalUrl) return emptyFreeBusyDiscovery("missing-principal");
      const [response] = await client.propfind({
        url: principalUrl,
        depth: "0",
        fetchOptions: { signal },
        props: {
          "c:calendar-user-address-set": {},
          "c:schedule-inbox-URL": {},
          "c:schedule-outbox-URL": {},
        },
      });
      const props = response?.props ?? {};
      const scheduleInboxUrl = resolveDavHref(props.scheduleInboxURL, client.account?.rootUrl);
      const scheduleOutboxUrl = resolveDavHref(props.scheduleOutboxURL, client.account?.rootUrl);
      const calendarUserAddresses = davHrefs(props.calendarUserAddressSet);
      const fetcher = client.fetchOverride ?? globalThis.fetch;
      const options = await fetcher(principalUrl, {
        method: "OPTIONS",
        headers: client.authHeaders,
        signal,
      });
      const autoSchedule = options.ok && (options.headers.get("DAV") ?? "").toLowerCase().split(",")
        .map((value: string) => value.trim()).includes("calendar-auto-schedule");
      const reason = !scheduleOutboxUrl ? "missing-outbox"
        : calendarUserAddresses.length === 0 ? "missing-user-address"
          : !autoSchedule ? "missing-auto-schedule" : "supported";
      return {
        supported: reason === "supported",
        autoSchedule,
        scheduleInboxUrl,
        scheduleOutboxUrl,
        calendarUserAddresses,
        reason,
      } satisfies CalDavFreeBusyDiscovery;
    });

    const result = isYandex
      ? { ...discovery, supported: false, reason: "yandex-unconfirmed" as const }
      : discovery;
    this.remoteFreeBusyCapability = result.supported ? "remote" : "none";
    console.info("[calendar-free-busy]", {
      event: "caldav_discovery",
      accountId: redactLogIdentifier(this.accountId),
      provider: isYandex ? "yandex" : "caldav",
      supported: result.supported,
      autoSchedule: result.autoSchedule,
      hasInbox: Boolean(result.scheduleInboxUrl),
      hasOutbox: Boolean(result.scheduleOutboxUrl),
      hasUserAddress: result.calendarUserAddresses.length > 0,
      reason: result.reason,
    });
    return result;
  }

  async queryRemoteFreeBusy(
    recipients: readonly string[],
    range: { start: number; end: number },
    signal?: AbortSignal,
  ): Promise<CalDavRemoteFreeBusyResult[]> {
    const discovery = await this.discoverRemoteFreeBusy(signal);
    if (!discovery.supported || !discovery.scheduleOutboxUrl || !discovery.calendarUserAddresses[0]) {
      return recipients.map((recipient) => ({ recipient, status: "error", busy: [] }));
    }
    const organizer = discovery.calendarUserAddresses[0];
    return this.withClient("free_busy_query", async (client) => {
      const addresses = recipients.map(mailtoAddress);
      const body = encodeVFreeBusyRequest({
        organizer,
        attendees: addresses,
        start: range.start,
        end: range.end,
        uid: crypto.randomUUID(),
        now: Math.floor(Date.now() / 1000),
      });
      const [response] = await client.davRequest({
        url: discovery.scheduleOutboxUrl!,
        convertIncoming: false,
        parseOutgoing: false,
        fetchOptions: { signal },
        init: {
          method: "POST",
          headers: { "Content-Type": "text/calendar; charset=utf-8" },
          body,
        },
      });
      if (!response?.ok) throw new Error(`CalDAV free busy failed (${response?.status ?? 0})`);
      return parseScheduleResponse(String(response.raw ?? ""), recipients);
    });
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const { calendars, principalUrl, rootUrl } = await this.withClient("list_calendars", async (client) => ({
      calendars: await client.fetchCalendars({
        props: {
          "d:displayname": {}, "d:resourcetype": {}, "d:sync-token": {}, "d:owner": {},
          "d:current-user-privilege-set": {}, "d:supported-privilege-set": {},
          "c:calendar-description": {}, "c:calendar-timezone": {}, "c:supported-calendar-component-set": {},
          "cs:getctag": {}, "ca:calendar-color": {},
        },
        projectedProps: {
          displayName: true, resourceType: true, syncToken: true, owner: true,
          currentUserPrivilegeSet: true, supportedPrivilegeSet: true,
          calendarDescription: true, calendarTimezone: true, components: true, ctag: true, calendarColor: true,
        },
      }),
      principalUrl: client.account?.principalUrl,
      rootUrl: client.account?.rootUrl,
    }));

    return calendars.map((cal, index) => ({
      remoteId: cal.url,
      displayName: typeof cal.displayName === "string" ? cal.displayName : `Calendar ${index + 1}`,
      color: extractCalendarColor(cal) ?? null,
      isPrimary: index === 0,
      access: davCalendarAccess({
        privileges: collectDavPrivilegeNames(cal.projectedProps?.currentUserPrivilegeSet),
        ownerHref: resolveDavHref(cal.projectedProps?.owner, rootUrl),
        currentPrincipalHref: principalUrl,
        primary: index === 0,
      }),
    }));
  }

  async fetchEvents(calendarRemoteId: string, timeMin: string, timeMax: string): Promise<CalendarEventData[]> {
    const objects = await this.withClient("fetch_events", (client) => client.fetchCalendarObjects({
      calendar: { url: calendarRemoteId } as DAVCalendar,
      timeRange: {
        start: timeMin,
        end: timeMax,
      },
    }));

    return this.parseCalendarObjects(objects, new Date(timeMin), new Date(timeMax));
  }

  async createEvent(calendarRemoteId: string, event: CreateEventInput): Promise<CalendarEventData> {
    const uid = crypto.randomUUID();
    const icalData = generateVEvent(event, uid);
    const filename = `${uid}.ics`;

    await this.withClient("create_event", async (client) => {
      const response = await client.createCalendarObject({
        calendar: { url: calendarRemoteId } as DAVCalendar,
        filename,
        iCalString: icalData,
      });
      await assertDavResponseOk(response, "create event");
    });

    const parsed = parseVEvent(icalData, joinCalendarObjectUrl(calendarRemoteId, filename));
    return parsed;
  }

  async updateEvent(
    calendarRemoteId: string,
    remoteEventId: string,
    event: UpdateEventInput,
    etag?: string,
    recurrence?: RecurringMutationContext,
  ): Promise<CalendarEventData> {
    return this.withClient("update_event", async (client) => {
      // Fetch the existing object to get its current data
      const objects = await client.fetchCalendarObjects({
        calendar: { url: calendarRemoteId } as DAVCalendar,
        objectUrls: [remoteEventId],
      });

      const existing = objects[0];
      if (!existing?.data) throw new Error("Event not found on server");

      const icalData = recurrence?.scope === "single" && recurrence.occurrence
        ? updateVEventOccurrence(existing.data, event, recurrence.seriesUid, recurrence.occurrence.identity)
        : updateVEventFields(existing.data, event);
      const response = await client.updateCalendarObject({
        calendarObject: {
          url: remoteEventId,
          data: icalData,
          etag: etag ?? existing.etag ?? undefined,
        } as DAVObject,
      });
      await assertDavResponseOk(response, "update event");

      const parsed = parseVEvent(icalData, remoteEventId);
      return recurrence?.scope === "single" && recurrence.occurrence
        ? { ...parsed, seriesUid: recurrence.seriesUid, occurrenceKey: recurrence.occurrence.key, isRecurrenceMaster: false }
        : parsed;
    });
  }

  async respondToEvent(
    calendarRemoteId: string,
    remoteEventId: string,
    attendeeEmail: string,
    status: CalendarParticipationStatus,
    etag?: string,
  ): Promise<void> {
    await this.withClient("respond_to_event", async (client) => {
      const objects = await client.fetchCalendarObjects({
        calendar: { url: calendarRemoteId } as DAVCalendar,
        objectUrls: [remoteEventId],
      });
      const existing = objects[0];
      if (!existing?.data) throw new Error("Событие не найдено на сервере");
      const data = updateAttendeeParticipation(existing.data, attendeeEmail, status);
      if (data === existing.data) throw new Error("Текущий аккаунт не найден среди участников");
      const response = await client.updateCalendarObject({
        calendarObject: { url: remoteEventId, data, etag: etag ?? existing.etag ?? undefined } as DAVObject,
      });
      await assertDavResponseOk(response, "respond to event");
    });
  }

  async deleteEvent(calendarRemoteId: string, remoteEventId: string, etag?: string, recurrence?: RecurringMutationContext): Promise<void> {
    await this.withClient("delete_event", async (client) => {
      if (recurrence?.scope === "single" && recurrence.occurrence) {
        const objects = await client.fetchCalendarObjects({
          calendar: { url: calendarRemoteId } as DAVCalendar,
          objectUrls: [remoteEventId],
        });
        const existing = objects[0];
        if (!existing?.data) throw new Error("Event not found on server");
        const data = excludeVEventOccurrence(existing.data, recurrence.seriesUid, recurrence.occurrence.identity);
        const response = await client.updateCalendarObject({
          calendarObject: { url: remoteEventId, data, etag: etag ?? existing.etag ?? undefined } as DAVObject,
        });
        await assertDavResponseOk(response, "exclude recurring occurrence");
        return;
      }
      const response = await client.deleteCalendarObject({
        calendarObject: {
          url: remoteEventId,
          etag: etag ?? undefined,
        } as DAVObject,
      });
      await assertDavResponseOk(response, "delete event");
    });
  }

  async syncEvents(calendarRemoteId: string, _syncToken?: string): Promise<CalendarSyncResult> {
    const created: CalendarEventData[] = [];

    // Full fetch — tsdav's syncCalendars doesn't reliably expose per-object deltas,
    // so we do a time-range fetch and let the DB upsert logic handle deduplication.
    const now = new Date();
    const timeMin = new Date(now);
    timeMin.setDate(timeMin.getDate() - 90);
    const timeMax = new Date(now);
    timeMax.setFullYear(timeMax.getFullYear() + 1);

    const objects = await this.withClient("sync_events", (client) => client.fetchCalendarObjects({
      calendar: { url: calendarRemoteId } as DAVCalendar,
      timeRange: {
        start: timeMin.toISOString(),
        end: timeMax.toISOString(),
      },
    }));

    created.push(...this.parseCalendarObjects(objects, timeMin, timeMax));

    return { created, updated: [], deletedRemoteIds: [], newSyncToken: null, newCtag: null };
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const calendars = await this.withClient("test_connection", (client) => client.fetchCalendars());
      await clearAccountDiagnostic(this.accountId, "caldav", "test_connection").catch(() => {});
      return {
        success: true,
        message: `Connected — found ${calendars.length} calendar${calendars.length !== 1 ? "s" : ""}`,
      };
    } catch (err) {
      const diagnostic = createConnectionDiagnostic(err, {
        accountId: this.accountId,
        provider: "caldav",
        layer: "caldav",
        operation: "test_connection",
      });
      await upsertAccountDiagnostic(diagnostic).catch(() => {});
      return { success: false, message: diagnostic.userMessage };
    }
  }

  private parseCalendarObjects(objects: DAVObject[], rangeStart: Date, rangeEnd: Date): CalendarEventData[] {
    const diagnostics = emptyReadDiagnostics();
    const events: CalendarEventData[] = [];
    for (const object of objects) {
      if (!object.data) continue;
      try {
        const parsed = parseVEventsInRangeDetailed(object.data, object.url, rangeStart, rangeEnd);
        diagnostics.unreadableComponentCount += parsed.diagnostics.unreadableComponentCount;
        diagnostics.unreadableObjectCount += parsed.diagnostics.unreadableObjectCount;
        events.push(...parsed.events.map((event) => ({ ...event, etag: object.etag ?? null })));
      } catch {
        diagnostics.unreadableObjectCount += 1;
      }
    }
    this._lastReadDiagnostics = diagnostics;
    if (diagnostics.unreadableComponentCount > 0 || diagnostics.unreadableObjectCount > 0) {
      console.warn("[calendar-read]", {
        provider: "caldav",
        accountId: redactLogIdentifier(this.accountId),
        unreadableComponentCount: diagnostics.unreadableComponentCount,
        unreadableObjectCount: diagnostics.unreadableObjectCount,
      });
    }
    return events;
  }
}

function emptyReadDiagnostics(): CalendarReadDiagnostics {
  return { unreadableComponentCount: 0, unreadableObjectCount: 0 };
}

function getSessionStaleReason(
  session: CalDavProviderSession,
  account: DbAccount,
): string | null {
  if (session.invalidated) return "invalidated";

  const credential = session.credential;
  const usesYandexOAuth = isYandexOAuthCalendarAccount(account);
  const expectedAuthKind: CalDavAuthKind = usesYandexOAuth ? "yandex_oauth" : "basic";
  const expectedServerUrl = account.caldav_url ?? (usesYandexOAuth ? YANDEX_CALDAV_URL : "");
  const expectedUsername = account.caldav_username ?? account.email;
  const expectedCredential = usesYandexOAuth ? account.access_token : account.caldav_password;
  const expectedExpiresAtMs = usesYandexOAuth && account.token_expires_at
    ? account.token_expires_at * 1000
    : null;

  if (
    credential.authKind !== expectedAuthKind ||
    credential.serverUrl !== expectedServerUrl ||
    credential.username !== expectedUsername ||
    credential.credentialValue !== (expectedCredential ?? "") ||
    credential.expiresAtMs !== expectedExpiresAtMs
  ) {
    return "credential_changed";
  }

  if (
    credential.expiresAtMs !== null &&
    credential.expiresAtMs - Date.now() <= OAUTH_TOKEN_REFRESH_BUFFER_MS
  ) {
    return "credential_expired_or_expiring";
  }

  return null;
}

function extractCalendarColor(cal: DAVCalendar): string | null {
  // tsdav may expose calendar-color in props
  const props = cal as unknown as Record<string, unknown>;
  if (typeof props.calendarColor === "string") return props.calendarColor;
  return null;
}

async function assertDavResponseOk(response: Response, action: string): Promise<void> {
  if (response.ok) return;

  let details = response.statusText;
  try {
    const text = await response.text();
    if (text.trim()) details = text.trim();
  } catch {
    // Keep the status text when the response body cannot be read.
  }

  throw new Error(`CalDAV ${action} failed (${response.status}): ${details}`);
}

function joinCalendarObjectUrl(calendarRemoteId: string, filename: string): string {
  try {
    return new URL(filename, calendarRemoteId).href;
  } catch {
    const separator = calendarRemoteId.endsWith("/") ? "" : "/";
    return `${calendarRemoteId}${separator}${filename}`;
  }
}

function emptyFreeBusyDiscovery(reason: CalDavFreeBusyDiscovery["reason"]): CalDavFreeBusyDiscovery {
  return {
    supported: false,
    autoSchedule: false,
    scheduleInboxUrl: null,
    scheduleOutboxUrl: null,
    calendarUserAddresses: [],
    reason,
  };
}

function davHrefs(value: unknown): string[] {
  const candidate = value as { href?: unknown } | null;
  const href = candidate?.href;
  if (Array.isArray(href)) return href.filter((entry): entry is string => typeof entry === "string");
  return typeof href === "string" ? [href] : [];
}

function resolveDavHref(value: unknown, base?: string): string | null {
  const href = davHrefs(value)[0];
  if (!href) return null;
  try { return new URL(href, base).href; } catch { return null; }
}

function mailtoAddress(value: string): string {
  return /^mailto:/i.test(value) ? value : `mailto:${value}`;
}

function parseScheduleResponse(xml: string, requested: readonly string[]): CalDavRemoteFreeBusyResult[] {
  const byRecipient = new Map<string, CalDavRemoteFreeBusyResult>();
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const responses = [...document.getElementsByTagNameNS("*", "response")];
  for (const response of responses) {
    const recipient = response.getElementsByTagNameNS("*", "recipient")[0]
      ?.getElementsByTagNameNS("*", "href")[0]?.textContent?.trim().replace(/^mailto:/i, "").toLowerCase();
    if (!recipient) continue;
    const requestStatus = response.getElementsByTagNameNS("*", "request-status")[0]?.textContent?.trim() ?? "";
    const calendarData = response.getElementsByTagNameNS("*", "calendar-data")[0]?.textContent ?? "";
    if (requestStatus.startsWith("2.") && calendarData.trim()) {
      try {
        byRecipient.set(recipient, { recipient, status: "known", busy: decodeVFreeBusy(calendarData) });
      } catch {
        byRecipient.set(recipient, { recipient, status: "error", busy: [] });
      }
    } else if (requestStatus.startsWith("3.7") || requestStatus.startsWith("3.8")) {
      byRecipient.set(recipient, { recipient, status: "permission-denied", busy: [] });
    } else {
      byRecipient.set(recipient, { recipient, status: "error", busy: [] });
    }
  }
  return requested.map((recipient) => byRecipient.get(recipient.toLowerCase())
    ?? { recipient, status: "error" as const, busy: [] });
}
