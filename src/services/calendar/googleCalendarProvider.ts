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
import {
  calendarDateToUnixSeconds,
  createOccurrenceKey,
  instantSecondsToWallDateTime,
  calendarOrganizerFromInput,
  createCalendarReminder,
  dedupeCalendarAttendees,
  normalizeCalendarReminderPolicy,
  normalizeParticipantEmail,
  participantRefFromEmail,
  participantRefFromUri,
  googleCalendarAccess,
  serializeCalendarParticipants,
  parseCalendarDate,
  type CalendarEventTime,
  type CalendarProviderCapabilities,
  type CalendarAclCapabilities,
  type CalendarShareEntry,
  type CalendarShareRole,
  type OccurrenceIdentity,
  CalendarAclError,
} from "./domain";
import { getGmailClient } from "@/services/gmail/tokenManager";
import type { GmailClient } from "@/services/gmail/client";
import { getAccount } from "@/services/db/accounts";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

interface GoogleCalendarListItem {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
  accessRole?: string;
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarListItem[];
  nextPageToken?: string;
}

interface GoogleAclRule {
  id: string;
  etag?: string;
  role: string;
  scope: { type: string; value?: string };
  deleted?: boolean;
}

interface GoogleAclListResponse {
  items?: GoogleAclRule[];
  nextPageToken?: string;
}

const GOOGLE_ACL_READ_SCOPES = new Set([
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.acls",
  "https://www.googleapis.com/auth/calendar.acls.readonly",
]);
const GOOGLE_ACL_WRITE_SCOPES = new Set([
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.acls",
]);

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status?: string;
  organizer?: { email: string; displayName?: string; self?: boolean };
  attendees?: { email: string; displayName?: string; responseStatus?: string; organizer?: boolean; self?: boolean; optional?: boolean; resource?: boolean; additionalGuests?: number }[];
  htmlLink?: string;
  iCalUID?: string;
  etag?: string;
  recurringEventId?: string;
  originalStartTime?: { dateTime?: string; date?: string; timeZone?: string };
  transparency?: string;
  sequence?: number;
  recurrence?: string[];
  reminders?: {
    useDefault?: boolean;
    overrides?: { method?: string; minutes?: number }[];
  };
}

interface GoogleEventListResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface GoogleMutationTarget {
  eventId: string;
  etag?: string;
  event?: GoogleCalendarEvent;
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly type: CalendarProviderType = "google_api";
  readonly capabilities: CalendarProviderCapabilities = {
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
    sync: { mode: "sync-token", pagination: true, durability: "durable" },
    freeBusy: { self: "local-derived", others: "remote" },
    permissions: "none",
    sharedCalendars: "manage",
    calendarAccess: { discovery: "full", ownership: "partial", effectivePermissions: "full", aclRead: "partial", aclWrite: "partial" },
    reminders: {
      read: "full",
      write: "full",
      multiple: true,
      methods: ["notification", "email"],
      defaults: "inherit",
      maxCount: 5,
    },
    conflictDetection: "etag",
  };
  readonly lastReadDiagnostics: CalendarReadDiagnostics = {
    unreadableComponentCount: 0,
    unreadableObjectCount: 0,
  };

  constructor(readonly accountId: string) {}

  private async getClient(): Promise<GmailClient> {
    return getGmailClient(this.accountId);
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const client = await this.getClient();
    const items: GoogleCalendarListItem[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ maxResults: "250" });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await client.request<GoogleCalendarListResponse>(
        `${CALENDAR_API_BASE}/users/me/calendarList?${params}`,
      );
      items.push(...(response.items ?? []));
      pageToken = response.nextPageToken;
    } while (pageToken);
    return items.map((cal) => ({
      remoteId: cal.id,
      displayName: cal.summary,
      color: cal.backgroundColor ?? null,
      isPrimary: !!cal.primary,
      access: googleCalendarAccess(cal.accessRole, !!cal.primary),
    }));
  }

  async discoverCalendarAcl(_calendarRemoteId: string): Promise<CalendarAclCapabilities> {
    const account = await getAccount(this.accountId);
    if (!account) return { read: "unknown", write: "unknown", reason: "account-missing" };
    const scopes = parseGrantedScopes(account.oauth_granted_scopes);
    if (scopes.size === 0) {
      return { read: "reauthorization-required", write: "reauthorization-required", reason: "scope-metadata-missing" };
    }
    const read = hasAnyScope(scopes, GOOGLE_ACL_READ_SCOPES) ? "supported" as const : "reauthorization-required" as const;
    const write = hasAnyScope(scopes, GOOGLE_ACL_WRITE_SCOPES) ? "supported" as const : "reauthorization-required" as const;
    return { read, write, reason: read === "supported" && write === "supported" ? null : "google-acl-scope-missing" };
  }

  async listCalendarShares(calendarRemoteId: string): Promise<CalendarShareEntry[]> {
    await this.assertAclSupport("read", calendarRemoteId);
    const client = await this.getClient();
    const account = await getAccount(this.accountId);
    const rules: GoogleAclRule[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ maxResults: "250", showDeleted: "false" });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await googleAclRequest<GoogleAclListResponse>(client,
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarRemoteId)}/acl?${params}`);
      rules.push(...(response.items ?? []).filter((rule) => !rule.deleted && rule.role !== "none"));
      pageToken = response.nextPageToken;
    } while (pageToken);
    return rules.map((rule) => mapGoogleAclRule(rule, account?.email ?? null));
  }

  async grantCalendarShare(
    calendarRemoteId: string,
    email: string,
    role: CalendarShareRole,
  ): Promise<CalendarShareEntry> {
    await this.assertAclSupport("write", calendarRemoteId);
    const client = await this.getClient();
    const rule = await googleAclRequest<GoogleAclRule>(client,
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarRemoteId)}/acl`, {
        method: "POST",
        body: JSON.stringify({ role: googleRole(role), scope: { type: "user", value: email } }),
      });
    const account = await getAccount(this.accountId);
    return mapGoogleAclRule(rule, account?.email ?? null);
  }

  async updateCalendarShareRole(
    calendarRemoteId: string,
    entryId: string,
    role: CalendarShareRole,
  ): Promise<CalendarShareEntry> {
    await this.assertAclSupport("write", calendarRemoteId);
    const client = await this.getClient();
    const existingRule = await this.getMutableGoogleRule(client, calendarRemoteId, entryId);
    const rule = await googleAclRequest<GoogleAclRule>(client,
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarRemoteId)}/acl/${encodeURIComponent(entryId)}`, {
        method: "PUT",
        body: JSON.stringify({ role: googleRole(role), scope: existingRule.scope }),
      }, entryId);
    const account = await getAccount(this.accountId);
    return mapGoogleAclRule(rule, account?.email ?? null);
  }

  async revokeCalendarShare(calendarRemoteId: string, entryId: string): Promise<void> {
    await this.assertAclSupport("write", calendarRemoteId);
    const client = await this.getClient();
    await this.getMutableGoogleRule(client, calendarRemoteId, entryId);
    await googleAclRequest<void>(client,
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarRemoteId)}/acl/${encodeURIComponent(entryId)}`,
      { method: "DELETE" }, entryId);
  }

  private async assertAclSupport(operation: "read" | "write", calendarRemoteId: string): Promise<void> {
    const capability = (await this.discoverCalendarAcl(calendarRemoteId))[operation];
    if (capability !== "supported") {
      throw new CalendarAclError(
        capability === "reauthorization-required" ? "reauthorization-required" : "unsupported",
        "Google Calendar ACL scope is not granted.",
      );
    }
  }

  private async getMutableGoogleRule(client: GmailClient, calendarRemoteId: string, entryId: string): Promise<GoogleAclRule> {
    const rule = await googleAclRequest<GoogleAclRule>(client,
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarRemoteId)}/acl/${encodeURIComponent(entryId)}`,
      {}, entryId);
    if (rule.role === "owner") {
      throw new CalendarAclError("owner-protected", "Owner access cannot be changed.", entryId);
    }
    const account = await getAccount(this.accountId);
    if (rule.scope.type === "user" && rule.scope.value && account?.email
      && normalizeParticipantEmail(rule.scope.value) === normalizeParticipantEmail(account.email)) {
      throw new CalendarAclError("current-user-protected", "Your own access cannot be changed here.", entryId);
    }
    return rule;
  }

  async fetchEvents(calendarRemoteId: string, timeMin: string, timeMax: string): Promise<CalendarEventData[]> {
    const client = await this.getClient();
    const encodedId = encodeURIComponent(calendarRemoteId);
    const events: CalendarEventData[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const url = `${CALENDAR_API_BASE}/calendars/${encodedId}/events?${params}`;
      const response = await client.request<GoogleEventListResponse>(url);
      events.push(...(response.items ?? []).map(mapGoogleEvent));
      pageToken = response.nextPageToken;
    } while (pageToken);

    return events;
  }

  async createEvent(calendarRemoteId: string, event: CreateEventInput): Promise<CalendarEventData> {
    const client = await this.getClient();
    const encodedId = encodeURIComponent(calendarRemoteId);
    const url = `${CALENDAR_API_BASE}/calendars/${encodedId}/events`;

    const body: Record<string, unknown> = {
      summary: event.summary,
      description: event.description,
      location: event.location,
    };

    if (event.time) {
      const timeBody = mapDomainTimeToGoogle(event.time);
      body.start = timeBody.start;
      body.end = timeBody.end;
    } else if (event.isAllDay) {
      body.start = { date: event.startTime.split("T")[0] };
      body.end = { date: event.endTime.split("T")[0] };
    } else {
      body.start = { dateTime: new Date(event.startTime).toISOString(), timeZone: "UTC" };
      body.end = { dateTime: new Date(event.endTime).toISOString(), timeZone: "UTC" };
    }

    if (event.attendees !== undefined) body.attendees = event.attendees.map(mapDomainAttendeeToGoogle);
    if (event.transparency) body.transparency = event.transparency;
    if (event.sequence !== undefined) body.sequence = event.sequence;
    if (event.reminders !== undefined) body.reminders = mapDomainRemindersToGoogle(event.reminders);
    if (event.recurrenceRule) {
      body.recurrence = [`RRULE:${sanitizeGoogleRecurrenceRule(event.recurrenceRule)}`];
    }

    const created = await client.request<GoogleCalendarEvent>(url, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const mapped = mapGoogleEvent(created);
    if (!mapped.recurrenceRule && event.recurrenceRule) {
      mapped.recurrenceRule = sanitizeGoogleRecurrenceRule(event.recurrenceRule);
    }
    return mapped;
  }

  async updateEvent(
    calendarRemoteId: string,
    remoteEventId: string,
    event: UpdateEventInput,
    etag?: string,
    recurrence?: RecurringMutationContext,
  ): Promise<CalendarEventData> {
    const client = await this.getClient();
    const encodedCalId = encodeURIComponent(calendarRemoteId);
    const target = await resolveGoogleMutationTarget(client, encodedCalId, remoteEventId, etag, recurrence);
    const encodedEventId = encodeURIComponent(target.eventId);
    const url = `${CALENDAR_API_BASE}/calendars/${encodedCalId}/events/${encodedEventId}`;

    const body: Record<string, unknown> = {};
    if (event.summary !== undefined) body.summary = event.summary;
    if (event.description !== undefined) body.description = event.description;
    if (event.location !== undefined) body.location = event.location;

    if (event.time) {
      const timeBody = mapDomainTimeToGoogle(event.time);
      body.start = timeBody.start;
      body.end = timeBody.end;
    } else if (event.startTime && event.endTime) {
      if (event.isAllDay) {
        body.start = { date: event.startTime.split("T")[0] };
        body.end = { date: event.endTime.split("T")[0] };
      } else {
        body.start = { dateTime: new Date(event.startTime).toISOString(), timeZone: "UTC" };
        body.end = { dateTime: new Date(event.endTime).toISOString(), timeZone: "UTC" };
      }
    }
    if (event.transparency !== undefined) body.transparency = event.transparency;
    if (event.sequence !== undefined) body.sequence = event.sequence;
    if (event.attendees !== undefined) body.attendees = event.attendees.map(mapDomainAttendeeToGoogle);
    if (event.reminders !== undefined) body.reminders = mapDomainRemindersToGoogle(event.reminders);
    if (event.recurrenceRule !== undefined) {
      const preserved = (target.event?.recurrence ?? []).filter((line) => !/^RRULE:/i.test(line));
      body.recurrence = event.recurrenceRule === null
        ? preserved
        : [`RRULE:${sanitizeGoogleRecurrenceRule(event.recurrenceRule)}`, ...preserved];
    }

    const updated = await client.request<GoogleCalendarEvent>(url, {
      method: "PATCH",
      headers: target.etag ? { "If-Match": target.etag } : undefined,
      body: JSON.stringify(body),
    });
    return mapGoogleEvent(updated);
  }

  async deleteEvent(calendarRemoteId: string, remoteEventId: string, etag?: string, recurrence?: RecurringMutationContext): Promise<void> {
    const client = await this.getClient();
    const encodedCalId = encodeURIComponent(calendarRemoteId);
    const target = await resolveGoogleMutationTarget(client, encodedCalId, remoteEventId, etag, recurrence);
    const encodedEventId = encodeURIComponent(target.eventId);
    const url = `${CALENDAR_API_BASE}/calendars/${encodedCalId}/events/${encodedEventId}`;
    await client.request(url, {
      method: "DELETE",
      headers: target.etag ? { "If-Match": target.etag } : undefined,
    });
  }

  async respondToEvent(
    calendarRemoteId: string,
    remoteEventId: string,
    attendeeEmail: string,
    status: CalendarParticipationStatus,
    etag?: string,
  ): Promise<void> {
    const client = await this.getClient();
    const base = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarRemoteId)}/events/${encodeURIComponent(remoteEventId)}`;
    const current = await client.request<GoogleCalendarEvent>(base);
    const attendees = (current.attendees ?? []).map((attendee) =>
      normalizeParticipantEmail(attendee.email) === normalizeParticipantEmail(attendeeEmail)
        ? { ...attendee, responseStatus: status }
        : attendee,
    );
    await client.request(`${base}?sendUpdates=all`, {
      method: "PATCH",
      headers: etag ? { "If-Match": etag } : undefined,
      body: JSON.stringify({ attendees }),
    });
  }

  async syncEvents(calendarRemoteId: string, syncToken?: string): Promise<CalendarSyncResult> {
    const client = await this.getClient();
    const encodedId = encodeURIComponent(calendarRemoteId);
    const created: CalendarEventData[] = [];
    const updated: CalendarEventData[] = [];
    const deletedRemoteIds: string[] = [];

    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;

    do {
      const params = new URLSearchParams({ maxResults: "250" });
      if (syncToken) {
        params.set("syncToken", syncToken);
      } else {
        // An unfiltered initial collection snapshot is required for deterministic
        // 410 recovery. Recurrence masters and overrides remain provider resources.
        params.set("showDeleted", "false");
      }
      if (pageToken) params.set("pageToken", pageToken);

      const url = `${CALENDAR_API_BASE}/calendars/${encodedId}/events?${params}`;

      let response: GoogleEventListResponse;
      try {
        response = await client.request<GoogleEventListResponse>(url);
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (message.includes("410") || message.includes("sync token")) {
          return {
            created: [], updated: [], deletedRemoteIds: [], newSyncToken: null, newCtag: null,
            cursorInvalidated: true, complete: false, authoritativeSnapshot: false,
            strategy: "sync-token",
          };
        }
        throw err;
      }

      for (const item of response.items ?? []) {
        if (item.status === "cancelled") {
          deletedRemoteIds.push(item.id);
        } else {
          const eventData = mapGoogleEvent(item);
          // For sync, we put everything in "created" (upsert logic handles deduplication)
          created.push(eventData);
        }
      }

      pageToken = response.nextPageToken;
      if (response.nextSyncToken) {
        nextSyncToken = response.nextSyncToken;
      }
    } while (pageToken);

    return {
      created, updated, deletedRemoteIds, newSyncToken: nextSyncToken, newCtag: null,
      complete: Boolean(nextSyncToken), authoritativeSnapshot: !syncToken, strategy: "sync-token",
    };
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.listCalendars();
      return { success: true, message: "Connected to Google Calendar" };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : "Connection failed" };
    }
  }
}

async function resolveGoogleMutationTarget(
  client: GmailClient,
  encodedCalendarId: string,
  remoteEventId: string,
  etag: string | undefined,
  recurrence: RecurringMutationContext | undefined,
): Promise<GoogleMutationTarget> {
  if (recurrence?.scope !== "series") return { eventId: remoteEventId, etag };
  const base = `${CALENDAR_API_BASE}/calendars/${encodedCalendarId}/events`;
  const supplied = await client.request<GoogleCalendarEvent>(`${base}/${encodeURIComponent(remoteEventId)}`);
  if (!supplied.recurringEventId) return { eventId: supplied.id, etag: supplied.etag ?? etag, event: supplied };
  const master = await client.request<GoogleCalendarEvent>(`${base}/${encodeURIComponent(supplied.recurringEventId)}`);
  return { eventId: master.id, etag: master.etag, event: master };
}

function sanitizeGoogleRecurrenceRule(rule: string): string {
  if (!rule || /\r|\n|^RRULE:/i.test(rule)) throw new Error("Invalid RRULE value");
  return rule;
}

function googleRecurrenceRule(event: GoogleCalendarEvent): string | null {
  const line = event.recurrence?.find((value) => /^RRULE:/i.test(value));
  if (!line) return null;
  return line.replace(/^\s*RRULE:/i, "").trim() || null;
}

export function mapGoogleEvent(event: GoogleCalendarEvent): CalendarEventData {
  const time = mapGoogleTime(event.start, event.end);
  const startTime = time.kind === "all-day" ? calendarDateToUnixSeconds(time.startDate) : time.start.instant;
  const endTime = time.kind === "all-day" ? calendarDateToUnixSeconds(time.endDateExclusive) : time.end.instant;
  const seriesUid = event.iCalUID ?? event.recurringEventId ?? event.id;
  const occurrenceIdentity = event.originalStartTime
    ? googleTimeIdentity(event.originalStartTime)
    : null;
  const occurrenceKey = event.recurringEventId && occurrenceIdentity
    ? createOccurrenceKey(seriesUid, occurrenceIdentity)
    : null;
  const organizer = event.organizer ? calendarOrganizerFromInput(event.organizer) : null;
  const attendees = dedupeCalendarAttendees((event.attendees ?? [])
    .filter((attendee) => !attendee.organizer || !organizer || normalizeParticipantEmail(attendee.email) !== organizer.participant.normalizedEmail)
    .map((attendee) => ({ ...attendee, status: attendee.responseStatus })));
  const participants = attendees.map((attendee) => attendee.participant);
  const reminderProjection = mapGoogleReminders(event.reminders);

  return {
    remoteEventId: event.id,
    uid: event.iCalUID ?? null,
    etag: event.etag ?? null,
    summary: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    startTime,
    endTime,
    isAllDay: time.kind === "all-day",
    status: event.status ?? "confirmed",
    organizerEmail: event.organizer?.email ?? null,
    attendeesJson: serializeCalendarParticipants({ organizer, attendees }),
    organizer,
    attendees,
    htmlLink: event.htmlLink ?? null,
    icalData: null,
    time,
    seriesUid,
    occurrenceKey,
    isRecurrenceMaster: false,
    transparency: event.transparency === "transparent" ? "transparent" : "opaque",
    sequence: event.sequence ?? 0,
    recurrenceRule: googleRecurrenceRule(event),
    participants,
    reminders: reminderProjection.policy,
    ...(reminderProjection.diagnostics.length > 0 ? { reminderDiagnostics: reminderProjection.diagnostics } : {}),
  };
}

export function mapGoogleReminders(input: GoogleCalendarEvent["reminders"]): {
  policy: import("./domain").CalendarReminderPolicy;
  diagnostics: import("./domain").CalendarReminderDiagnostic[];
} {
  if (!input || input.useDefault !== false) return { policy: { kind: "inherit" }, diagnostics: [] };
  const diagnostics: import("./domain").CalendarReminderDiagnostic[] = [];
  const reminders = (input.overrides ?? []).flatMap((override) => {
    const method = override.method === "popup" ? "notification" : override.method === "email" ? "email" : null;
    if (!method) {
      diagnostics.push({ code: "unsupported-method", ...(override.method ? { action: override.method } : {}) });
      return [];
    }
    if (!Number.isSafeInteger(override.minutes) || override.minutes! < 0 || override.minutes! > 40320) {
      diagnostics.push({ code: "invalid-trigger", action: override.method });
      return [];
    }
    return [createCalendarReminder(override.minutes!, "minutes", method)];
  });
  if (reminders.length > 5) diagnostics.push({ code: "too-many-reminders" });
  return {
    policy: normalizeCalendarReminderPolicy(reminders.length > 0 ? { kind: "custom", reminders: reminders.slice(0, 5) } : { kind: "none" }),
    diagnostics,
  };
}

export function mapDomainRemindersToGoogle(
  input: import("./domain").CalendarReminderPolicy,
): NonNullable<GoogleCalendarEvent["reminders"]> {
  const policy = normalizeCalendarReminderPolicy(input);
  if (policy.kind === "inherit") return { useDefault: true };
  if (policy.kind === "none") return { useDefault: false, overrides: [] };
  if (policy.reminders.length > 5) throw new Error("Google Calendar supports at most 5 reminder overrides");
  return {
    useDefault: false,
    overrides: policy.reminders.map((reminder) => ({
      method: reminder.method === "notification" ? "popup" : "email",
      minutes: reminder.trigger.duration.seconds / 60,
    })),
  };
}

function mapDomainAttendeeToGoogle(input: import("./domain").CalendarAttendeeInput): Record<string, unknown> {
  const attendee = dedupeCalendarAttendees([input])[0];
  if (!attendee) return {};
  const responseStatus = attendee.status === "needs-action"
    ? (attendee.rawStatus ? "needsAction" : undefined)
    : attendee.status === "unknown" ? undefined : attendee.status;
  return {
    email: attendee.participant.value,
    ...(attendee.participant.displayName ? { displayName: attendee.participant.displayName } : {}),
    ...(attendee.role === "optional" ? { optional: true } : {}),
    ...(responseStatus ? { responseStatus } : {}),
    ...(attendee.participantType === "resource" || attendee.participantType === "room" ? { resource: true } : {}),
    ...(attendee.additionalGuests !== undefined ? { additionalGuests: attendee.additionalGuests } : {}),
  };
}

type GoogleEventTime = Exclude<CalendarEventTime, { kind: "floating" }>;

function mapGoogleTime(
  start: GoogleCalendarEvent["start"],
  end: GoogleCalendarEvent["end"],
): GoogleEventTime {
  if (start.date) {
    if (!end.date) throw new Error("Google all-day event is missing exclusive end date");
    return { kind: "all-day", startDate: parseIsoCalendarDate(start.date), endDateExclusive: parseIsoCalendarDate(end.date) };
  }
  if (!start.dateTime || !end.dateTime) throw new Error("Google timed event is missing dateTime");
  const startInstant = Math.floor(new Date(start.dateTime).getTime() / 1000);
  const endInstant = Math.floor(new Date(end.dateTime).getTime() / 1000);
  const startTzid = start.timeZone ?? "UTC";
  const endTzid = end.timeZone ?? startTzid;
  return {
    kind: "timed-zoned",
    start: { wall: instantSecondsToWallDateTime(startInstant, startTzid), tzid: startTzid, instant: startInstant },
    end: { wall: instantSecondsToWallDateTime(endInstant, endTzid), tzid: endTzid, instant: endInstant },
  };
}

function googleTimeIdentity(value: NonNullable<GoogleCalendarEvent["originalStartTime"]>): OccurrenceIdentity | null {
  if (value.date) return { kind: "all-day", date: parseIsoCalendarDate(value.date) };
  if (!value.dateTime) return null;
  const instant = Math.floor(new Date(value.dateTime).getTime() / 1000);
  const tzid = value.timeZone ?? "UTC";
  return { kind: "timed-zoned", wall: instantSecondsToWallDateTime(instant, tzid), tzid };
}

function mapDomainTimeToGoogle(time: CalendarEventTime): { start: Record<string, string>; end: Record<string, string> } {
  if (time.kind === "all-day") {
    return { start: { date: time.startDate }, end: { date: time.endDateExclusive } };
  }
  if (time.kind === "floating") {
    throw new Error("Google Calendar write requires an explicit event timezone for floating time");
  }
  return {
    start: { dateTime: new Date(time.start.instant * 1000).toISOString(), timeZone: time.start.tzid },
    end: { dateTime: new Date(time.end.instant * 1000).toISOString(), timeZone: time.end.tzid },
  };
}

function parseIsoCalendarDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid Google calendar date: ${value}`);
  return parseCalendarDate(`${match[1]}${match[2]}${match[3]}`);
}

function parseGrantedScopes(value: string | null | undefined): Set<string> {
  return new Set((value ?? "").split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean));
}

function hasAnyScope(granted: ReadonlySet<string>, expected: ReadonlySet<string>): boolean {
  return [...expected].some((scope) => granted.has(scope));
}

function googleRole(role: CalendarShareRole): string {
  switch (role) {
    case "writer": return "writer";
    case "reader": return "reader";
    case "free-busy-only": return "freeBusyReader";
    case "owner": throw new CalendarAclError("owner-protected", "Ownership transfer is not supported by this flow.");
  }
}

function domainRoleFromGoogle(role: string): CalendarShareRole {
  switch (role) {
    case "owner": return "owner";
    case "writer": return "writer";
    case "reader": return "reader";
    case "freeBusyReader": return "free-busy-only";
    default: throw new CalendarAclError("provider-error", "Google returned an unsupported sharing role.");
  }
}

function mapGoogleAclRule(rule: GoogleAclRule, currentEmail: string | null): CalendarShareEntry {
  const value = rule.scope.value?.trim() || null;
  const principalType = rule.scope.type === "default" ? "public"
    : rule.scope.type === "user" || rule.scope.type === "group" || rule.scope.type === "domain"
      ? rule.scope.type : "unknown";
  const participant = value
    ? (principalType === "user" || principalType === "group"
        ? participantRefFromEmail(value)
        : participantRefFromUri(value))
    : null;
  const role = domainRoleFromGoogle(rule.role);
  const isCurrentUser = !!currentEmail && !!participant?.normalizedEmail
    && participant.normalizedEmail === normalizeParticipantEmail(currentEmail);
  const isOwner = role === "owner";
  return {
    id: rule.id,
    participant,
    principalType,
    principalValue: value,
    displayName: null,
    role,
    isCurrentUser,
    isOwner,
    isProtected: isOwner || isCurrentUser,
  };
}

async function googleAclRequest<T>(
  client: GmailClient,
  url: string,
  options: RequestInit = {},
  entryId: string | null = null,
): Promise<T> {
  try {
    return await client.request<T>(url, options);
  } catch (error) {
    if (error instanceof CalendarAclError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const status = Number(/API error:\s*(\d{3})/i.exec(message)?.[1] ?? 0);
    if (status === 401 || status === 403) {
      throw new CalendarAclError("permission-denied", "Google denied calendar sharing access.", entryId);
    }
    if (status === 404) throw new CalendarAclError("entry-not-found", "Sharing entry no longer exists.", entryId);
    if (status === 409) throw new CalendarAclError("duplicate-principal", "This person already has calendar access.", entryId);
    throw new CalendarAclError("provider-error", "Google Calendar sharing request failed.", entryId);
  }
}
