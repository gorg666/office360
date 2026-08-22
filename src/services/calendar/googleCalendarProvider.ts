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
} from "./types";
import {
  calendarDateToUnixSeconds,
  createOccurrenceKey,
  instantSecondsToWallDateTime,
  participantRefFromEmail,
  parseCalendarDate,
  type CalendarEventTime,
  type CalendarProviderCapabilities,
  type OccurrenceIdentity,
} from "./domain";
import { getGmailClient } from "@/services/gmail/tokenManager";
import type { GmailClient } from "@/services/gmail/client";

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
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status?: string;
  organizer?: { email: string; displayName?: string };
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  htmlLink?: string;
  iCalUID?: string;
  etag?: string;
  recurringEventId?: string;
  originalStartTime?: { dateTime?: string; date?: string; timeZone?: string };
  transparency?: string;
  sequence?: number;
}

interface GoogleEventListResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly type: CalendarProviderType = "google_api";
  readonly capabilities: CalendarProviderCapabilities = {
    version: 1,
    events: { create: true, update: true, delete: true },
    recurrence: { read: true, write: false, scopes: ["instance", "series"] },
    rsvp: "direct",
    freeBusy: "native",
    sync: { mode: "sync-token", pagination: true },
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
    const response = await client.request<GoogleCalendarListResponse>(
      `${CALENDAR_API_BASE}/users/me/calendarList`,
    );
    return (response.items ?? []).map((cal) => ({
      remoteId: cal.id,
      displayName: cal.summary,
      color: cal.backgroundColor ?? null,
      isPrimary: !!cal.primary,
    }));
  }

  async fetchEvents(calendarRemoteId: string, timeMin: string, timeMax: string): Promise<CalendarEventData[]> {
    const client = await this.getClient();
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });

    const encodedId = encodeURIComponent(calendarRemoteId);
    const url = `${CALENDAR_API_BASE}/calendars/${encodedId}/events?${params}`;
    const response = await client.request<GoogleEventListResponse>(url);
    return (response.items ?? []).map(mapGoogleEvent);
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

    if (event.attendees) {
      body.attendees = event.attendees;
    }
    if (event.transparency) body.transparency = event.transparency;
    if (event.sequence !== undefined) body.sequence = event.sequence;

    const created = await client.request<GoogleCalendarEvent>(url, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return mapGoogleEvent(created);
  }

  async updateEvent(calendarRemoteId: string, remoteEventId: string, event: UpdateEventInput): Promise<CalendarEventData> {
    const client = await this.getClient();
    const encodedCalId = encodeURIComponent(calendarRemoteId);
    const encodedEventId = encodeURIComponent(remoteEventId);
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

    const updated = await client.request<GoogleCalendarEvent>(url, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return mapGoogleEvent(updated);
  }

  async deleteEvent(calendarRemoteId: string, remoteEventId: string): Promise<void> {
    const client = await this.getClient();
    const encodedCalId = encodeURIComponent(calendarRemoteId);
    const encodedEventId = encodeURIComponent(remoteEventId);
    const url = `${CALENDAR_API_BASE}/calendars/${encodedCalId}/events/${encodedEventId}`;
    await client.request(url, { method: "DELETE" });
  }

  async respondToEvent(
    calendarRemoteId: string,
    remoteEventId: string,
    attendeeEmail: string,
    status: CalendarParticipationStatus,
  ): Promise<void> {
    const client = await this.getClient();
    const base = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarRemoteId)}/events/${encodeURIComponent(remoteEventId)}`;
    const current = await client.request<GoogleCalendarEvent>(base);
    const attendees = (current.attendees ?? []).map((attendee) =>
      attendee.email.toLowerCase() === attendeeEmail.toLowerCase()
        ? { ...attendee, responseStatus: status }
        : attendee,
    );
    await client.request(`${base}?sendUpdates=all`, { method: "PATCH", body: JSON.stringify({ attendees }) });
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
        // Initial sync: fetch last 90 days to 365 days forward
        const timeMin = new Date();
        timeMin.setDate(timeMin.getDate() - 90);
        params.set("timeMin", timeMin.toISOString());
        const timeMax = new Date();
        timeMax.setFullYear(timeMax.getFullYear() + 1);
        params.set("timeMax", timeMax.toISOString());
        params.set("singleEvents", "true");
      }
      if (pageToken) params.set("pageToken", pageToken);

      const url = `${CALENDAR_API_BASE}/calendars/${encodedId}/events?${params}`;

      let response: GoogleEventListResponse;
      try {
        response = await client.request<GoogleEventListResponse>(url);
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (message.includes("410") || message.includes("sync token")) {
          // Sync token expired — caller should do full sync
          return { created: [], updated: [], deletedRemoteIds: [], newSyncToken: null, newCtag: null };
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

    return { created, updated, deletedRemoteIds, newSyncToken: nextSyncToken, newCtag: null };
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
  const participants = (event.attendees ?? []).map((attendee) =>
    participantRefFromEmail(attendee.email, attendee.displayName));

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
    attendeesJson: event.attendees ? JSON.stringify(event.attendees) : null,
    htmlLink: event.htmlLink ?? null,
    icalData: null,
    time,
    seriesUid,
    occurrenceKey,
    isRecurrenceMaster: false,
    transparency: event.transparency === "transparent" ? "transparent" : "opaque",
    sequence: event.sequence ?? 0,
    participants,
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
