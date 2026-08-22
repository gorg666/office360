import type { CalendarEventTime, CalendarProviderCapabilities, ParticipantRef } from "./domain";

export type CalendarProviderType = "google_api" | "caldav";

export interface CalendarInfo {
  remoteId: string;
  displayName: string;
  color: string | null;
  isPrimary: boolean;
}

export interface CalendarEventData {
  instanceId?: string;
  remoteEventId: string;
  uid: string | null;
  etag: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  startTime: number;
  endTime: number;
  isAllDay: boolean;
  status: string;
  organizerEmail: string | null;
  attendeesJson: string | null;
  htmlLink: string | null;
  icalData: string | null;
  time: CalendarEventTime;
  seriesUid: string | null;
  occurrenceKey: string | null;
  isRecurrenceMaster: boolean;
  transparency: "opaque" | "transparent" | null;
  sequence: number;
  participants: ParticipantRef[];
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  startTime: string; // ISO 8601
  endTime: string;   // ISO 8601
  isAllDay?: boolean;
  attendees?: { email: string }[];
  time?: CalendarEventTime;
  transparency?: "opaque" | "transparent";
  sequence?: number;
}

export interface UpdateEventInput {
  summary?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  isAllDay?: boolean;
  time?: CalendarEventTime;
  transparency?: "opaque" | "transparent";
  sequence?: number;
}

export type CalendarParticipationStatus = "accepted" | "tentative" | "declined";

export interface CalendarReadDiagnostics {
  unreadableComponentCount: number;
  unreadableObjectCount: number;
}

export interface CalendarSyncResult {
  created: CalendarEventData[];
  updated: CalendarEventData[];
  deletedRemoteIds: string[];
  newSyncToken: string | null;
  newCtag: string | null;
}

export interface CalendarProvider {
  readonly accountId: string;
  readonly type: CalendarProviderType;
  readonly capabilities: CalendarProviderCapabilities;
  readonly lastReadDiagnostics?: CalendarReadDiagnostics;

  listCalendars(): Promise<CalendarInfo[]>;

  fetchEvents(calendarRemoteId: string, timeMin: string, timeMax: string): Promise<CalendarEventData[]>;
  createEvent(calendarRemoteId: string, event: CreateEventInput): Promise<CalendarEventData>;
  updateEvent(calendarRemoteId: string, remoteEventId: string, event: UpdateEventInput, etag?: string): Promise<CalendarEventData>;
  deleteEvent(calendarRemoteId: string, remoteEventId: string, etag?: string): Promise<void>;
  respondToEvent?(
    calendarRemoteId: string,
    remoteEventId: string,
    attendeeEmail: string,
    status: CalendarParticipationStatus,
    etag?: string,
  ): Promise<void>;

  syncEvents(calendarRemoteId: string, syncToken?: string): Promise<CalendarSyncResult>;

  testConnection(): Promise<{ success: boolean; message: string }>;
}
