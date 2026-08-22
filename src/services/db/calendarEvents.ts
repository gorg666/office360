import { getDb, selectFirstBy } from "./connection";
import { parseVEvent } from "@/services/calendar/icalHelper";
import {
  calendarDateFromUnixSecondsUtc,
  formatWallDateTime,
  instantSecondsToWallDateTime,
  type CalendarEventTime,
} from "@/services/calendar/domain";

export interface DbCalendarEvent {
  id: string;
  account_id: string;
  google_event_id: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  start_time: number;
  end_time: number;
  is_all_day: number;
  status: string;
  organizer_email: string | null;
  attendees_json: string | null;
  html_link: string | null;
  updated_at: number;
  // New CalDAV fields (nullable for backward compat)
  calendar_id: string | null;
  remote_event_id: string | null;
  etag: string | null;
  ical_data: string | null;
  uid: string | null;
  time_kind: "timed-zoned" | "floating" | "all-day" | null;
  tzid: string | null;
  wall_start: string | null;
  wall_end: string | null;
  end_date_exclusive: string | null;
  series_uid: string | null;
  occurrence_key: string | null;
  is_recurrence_master: number;
  transp: "opaque" | "transparent" | null;
  sequence: number;
}

export async function upsertCalendarEvent(event: {
  accountId: string;
  googleEventId: string;
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
  calendarId?: string | null;
  remoteEventId?: string | null;
  etag?: string | null;
  icalData?: string | null;
  uid?: string | null;
  time?: CalendarEventTime;
  seriesUid?: string | null;
  occurrenceKey?: string | null;
  isRecurrenceMaster?: boolean;
  transparency?: "opaque" | "transparent" | null;
  sequence?: number;
}): Promise<void> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const semantic = semanticColumns(event.time);
  await db.execute(
    `INSERT INTO calendar_events (id, account_id, google_event_id, summary, description, location, start_time, end_time, is_all_day, status, organizer_email, attendees_json, html_link, calendar_id, remote_event_id, etag, ical_data, uid, time_kind, tzid, wall_start, wall_end, end_date_exclusive, series_uid, occurrence_key, is_recurrence_master, transp, sequence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
     ON CONFLICT(account_id, google_event_id) DO UPDATE SET
       summary = $4, description = $5, location = $6, start_time = $7, end_time = $8,
       is_all_day = $9, status = $10, organizer_email = $11, attendees_json = $12,
       html_link = $13, calendar_id = $14, remote_event_id = $15, etag = $16,
       ical_data = $17, uid = $18, time_kind = $19, tzid = $20, wall_start = $21,
       wall_end = $22, end_date_exclusive = $23, series_uid = $24, occurrence_key = $25,
       is_recurrence_master = $26, transp = $27, sequence = $28, updated_at = unixepoch()`,
    [
      id, event.accountId, event.googleEventId, event.summary, event.description,
      event.location, event.startTime, event.endTime, event.isAllDay ? 1 : 0,
      event.status, event.organizerEmail, event.attendeesJson, event.htmlLink,
      event.calendarId ?? null, event.remoteEventId ?? null, event.etag ?? null,
      event.icalData ?? null, event.uid ?? null,
      semantic.timeKind, semantic.tzid, semantic.wallStart, semantic.wallEnd,
      semantic.endDateExclusive, event.seriesUid ?? event.uid ?? null,
      event.occurrenceKey ?? null, event.isRecurrenceMaster ? 1 : 0,
      event.transparency ?? null, event.sequence ?? 0,
    ],
  );
}

export async function getCalendarEventsInRange(
  accountId: string,
  startTime: number,
  endTime: number,
): Promise<DbCalendarEvent[]> {
  const db = await getDb();
  const rows = await db.select<DbCalendarEvent[]>(
    `SELECT * FROM calendar_events
     WHERE account_id = $1 AND start_time < $3 AND end_time > $2
     ORDER BY start_time ASC`,
    [accountId, startTime, endTime],
  );
  return rows.map(normalizeCalendarEventRow);
}

export async function getCalendarEventsInRangeMulti(
  accountId: string,
  calendarIds: string[],
  startTime: number,
  endTime: number,
): Promise<DbCalendarEvent[]> {
  if (calendarIds.length === 0) {
    return getCalendarEventsInRange(accountId, startTime, endTime);
  }
  const db = await getDb();
  const placeholders = calendarIds.map((_, i) => `$${i + 4}`).join(", ");
  const rows = await db.select<DbCalendarEvent[]>(
    `SELECT * FROM calendar_events
     WHERE account_id = $1 AND start_time < $3 AND end_time > $2
       AND (calendar_id IN (${placeholders}) OR calendar_id IS NULL)
     ORDER BY start_time ASC`,
    [accountId, startTime, endTime, ...calendarIds],
  );
  return rows.map(normalizeCalendarEventRow);
}

export async function deleteEventsForCalendar(calendarId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM calendar_events WHERE calendar_id = $1", [calendarId]);
}

export async function deleteCalendarEventsInRange(
  accountId: string,
  calendarId: string,
  startTime: number,
  endTime: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM calendar_events
     WHERE account_id = $1 AND calendar_id = $2
       AND start_time < $4 AND end_time > $3`,
    [accountId, calendarId, startTime, endTime],
  );
}

export async function getEventByRemoteId(
  calendarId: string,
  remoteEventId: string,
): Promise<DbCalendarEvent | null> {
  const row = await selectFirstBy<DbCalendarEvent>(
    "SELECT * FROM calendar_events WHERE calendar_id = $1 AND remote_event_id = $2",
    [calendarId, remoteEventId],
  );
  return row ? normalizeCalendarEventRow(row) : null;
}

export async function deleteEventByRemoteId(
  calendarId: string,
  remoteEventId: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM calendar_events WHERE calendar_id = $1 AND remote_event_id = $2",
    [calendarId, remoteEventId],
  );
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM calendar_events WHERE id = $1", [eventId]);
}

export function normalizeCalendarEventRow(row: DbCalendarEvent): DbCalendarEvent {
  if (row.time_kind) return row;
  if (row.ical_data) {
    try {
      const event = parseVEvent(row.ical_data, row.remote_event_id ?? row.google_event_id);
      const semantic = semanticColumns(event.time);
      return {
        ...row,
        time_kind: semantic.timeKind,
        tzid: semantic.tzid,
        wall_start: semantic.wallStart,
        wall_end: semantic.wallEnd,
        end_date_exclusive: semantic.endDateExclusive,
        series_uid: event.seriesUid ?? row.uid,
        occurrence_key: event.occurrenceKey,
        is_recurrence_master: event.isRecurrenceMaster ? 1 : 0,
        transp: event.transparency,
        sequence: event.sequence,
      };
    } catch {
      // Preserve a readable legacy row even when its raw ICS is malformed.
    }
  }
  if (row.is_all_day === 1) {
    return {
      ...row,
      time_kind: "all-day",
      wall_start: null,
      wall_end: null,
      end_date_exclusive: calendarDateFromUnixSecondsUtc(row.end_time),
      series_uid: row.uid,
      occurrence_key: null,
      is_recurrence_master: 0,
      transp: null,
      sequence: 0,
    };
  }
  return {
    ...row,
    time_kind: "timed-zoned",
    tzid: "UTC",
    wall_start: formatWallDateTime(instantSecondsToWallDateTime(row.start_time, "UTC")),
    wall_end: formatWallDateTime(instantSecondsToWallDateTime(row.end_time, "UTC")),
    end_date_exclusive: null,
    series_uid: row.uid,
    occurrence_key: null,
    is_recurrence_master: 0,
    transp: null,
    sequence: 0,
  };
}

function semanticColumns(time: CalendarEventTime | undefined): {
  timeKind: DbCalendarEvent["time_kind"];
  tzid: string | null;
  wallStart: string | null;
  wallEnd: string | null;
  endDateExclusive: string | null;
} {
  if (!time) return { timeKind: null, tzid: null, wallStart: null, wallEnd: null, endDateExclusive: null };
  if (time.kind === "all-day") {
    return { timeKind: time.kind, tzid: null, wallStart: null, wallEnd: null, endDateExclusive: time.endDateExclusive };
  }
  if (time.kind === "floating") {
    return {
      timeKind: time.kind,
      tzid: null,
      wallStart: formatWallDateTime(time.start),
      wallEnd: formatWallDateTime(time.end),
      endDateExclusive: null,
    };
  }
  return {
    timeKind: time.kind,
    tzid: time.start.tzid,
    wallStart: formatWallDateTime(time.start.wall),
    wallEnd: formatWallDateTime(time.end.wall),
    endDateExclusive: null,
  };
}
