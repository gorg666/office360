import type Database from "@tauri-apps/plugin-sql";
import { getDb, selectFirstBy, withTransaction } from "./connection";
import { parseVEvent } from "@/services/calendar/icalHelper";
import type { CalendarEventData, CalendarReadDiagnostics } from "@/services/calendar/types";
import { recordCalendarRangeCoverage } from "./calendarSyncCoverage";
import {
  calendarDateFromUnixSecondsUtc,
  formatWallDateTime,
  instantSecondsToWallDateTime,
  serializeCalendarReminderPolicy,
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
  origin: "remote" | "local_projection" | null;
  projection_key: string | null;
  projection_status: "pending" | "failed" | null;
  reminders_json: string | null;
}

const LEGACY_NORMALIZATION_CACHE_LIMIT = 2_000;
const legacyNormalizationCache = new Map<string, DbCalendarEvent>();

export interface UpsertCalendarEventInput {
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
  origin?: "remote" | "local_projection";
  projectionKey?: string | null;
  projectionStatus?: "pending" | "failed" | null;
  remindersJson?: string | null;
}

export async function upsertCalendarEvent(event: UpsertCalendarEventInput): Promise<void> {
  const db = await getDb();
  await upsertCalendarEventWithDb(db, event);
}

async function upsertCalendarEventWithDb(db: Database, event: UpsertCalendarEventInput): Promise<void> {
  const id = crypto.randomUUID();
  const semantic = semanticColumns(event.time);
  await db.execute(
    `INSERT INTO calendar_events (id, account_id, google_event_id, summary, description, location, start_time, end_time, is_all_day, status, organizer_email, attendees_json, html_link, calendar_id, remote_event_id, etag, ical_data, uid, time_kind, tzid, wall_start, wall_end, end_date_exclusive, series_uid, occurrence_key, is_recurrence_master, transp, sequence, origin, projection_key, projection_status, reminders_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
     ON CONFLICT(account_id, google_event_id) DO UPDATE SET
       summary = $4, description = $5, location = $6, start_time = $7, end_time = $8,
       is_all_day = $9, status = $10, organizer_email = $11, attendees_json = $12,
       html_link = $13, calendar_id = $14, remote_event_id = $15, etag = $16,
       ical_data = $17, uid = $18, time_kind = $19, tzid = $20, wall_start = $21,
       wall_end = $22, end_date_exclusive = $23, series_uid = $24, occurrence_key = $25,
       is_recurrence_master = $26, transp = $27, sequence = $28, origin = $29,
       projection_key = $30, projection_status = $31, reminders_json = $32,
       updated_at = unixepoch()`,
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
      event.origin ?? "remote", event.projectionKey ?? null, event.projectionStatus ?? null,
      event.remindersJson ?? null,
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
    const db = await getDb();
    const rows = await db.select<DbCalendarEvent[]>(
      `SELECT * FROM calendar_events
       WHERE account_id = $1 AND start_time < $3 AND end_time > $2
         AND (
           origin = 'local_projection'
           OR (origin IS NULL AND calendar_id IS NULL AND google_event_id LIKE 'invite:%')
         )
       ORDER BY start_time ASC`,
      [accountId, startTime, endTime],
    );
    return rows.map(normalizeCalendarEventRow);
  }
  const db = await getDb();
  const placeholders = calendarIds.map((_, i) => `$${i + 4}`).join(", ");
  const rows = await db.select<DbCalendarEvent[]>(
    `SELECT * FROM calendar_events
     WHERE account_id = $1 AND start_time < $3 AND end_time > $2
       AND (
         calendar_id IN (${placeholders})
         OR origin = 'local_projection'
         OR (origin IS NULL AND calendar_id IS NULL AND google_event_id LIKE 'invite:%')
       )
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

export async function getCalendarEventByUid(
  accountId: string,
  uid: string,
  occurrenceStart: number | null = null,
): Promise<DbCalendarEvent | null> {
  const row = await selectFirstBy<DbCalendarEvent>(
    `SELECT * FROM calendar_events
     WHERE account_id = $1 AND (uid = $2 OR series_uid = $2)
       AND ($3 IS NULL OR start_time = $3)
     ORDER BY CASE WHEN origin = 'remote' THEN 0 ELSE 1 END,
              is_recurrence_master ASC,
              updated_at DESC
     LIMIT 1`,
    [accountId, uid, occurrenceStart],
  );
  return row ? normalizeCalendarEventRow(row) : null;
}

export function calendarProjectionKey(uid: string, recurrenceKey: string): string {
  return `invite:${uid}:${recurrenceKey}`;
}

export async function removeCalendarProjection(accountId: string, projectionKey: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM calendar_events
     WHERE account_id = $1 AND (
       projection_key = $2
       OR (projection_key IS NULL AND google_event_id = $2 AND calendar_id IS NULL)
     )`,
    [accountId, projectionKey],
  );
}

export async function reconcileCalendarEventsRange(input: {
  accountId: string;
  calendarId: string;
  rangeStart: number;
  rangeEnd: number;
  events: CalendarEventData[];
  diagnostics: CalendarReadDiagnostics;
}): Promise<void> {
  const authoritative = input.diagnostics.unreadableComponentCount === 0
    && input.diagnostics.unreadableObjectCount === 0;

  await withTransaction(async (db) => {
    for (const event of input.events) {
      await upsertCalendarEventWithDb(db, calendarEventDataToUpsert(input.accountId, input.calendarId, event));
    }

    await removeMatchedProjectionsWithDb(db, input.accountId, input.events);

    if (authoritative) {
      await deleteMissingRemoteEventsWithDb(db, input);
    }

    await recordCalendarRangeCoverage({
      accountId: input.accountId,
      calendarId: input.calendarId,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      state: authoritative ? "complete" : "partial",
      unreadableComponentCount: input.diagnostics.unreadableComponentCount,
      unreadableObjectCount: input.diagnostics.unreadableObjectCount,
    }, db);
  });
}

export function calendarEventDataToUpsert(
  accountId: string,
  calendarId: string | null,
  event: CalendarEventData,
): UpsertCalendarEventInput {
  return {
    accountId,
    googleEventId: event.instanceId ?? event.remoteEventId,
    summary: event.summary,
    description: event.description,
    location: event.location,
    startTime: event.startTime,
    endTime: event.endTime,
    isAllDay: event.isAllDay,
    status: event.status,
    organizerEmail: event.organizerEmail,
    attendeesJson: event.attendeesJson,
    htmlLink: event.htmlLink,
    calendarId,
    remoteEventId: event.remoteEventId,
    etag: event.etag,
    icalData: event.icalData,
    uid: event.uid,
    time: event.time,
    seriesUid: event.seriesUid,
    occurrenceKey: event.occurrenceKey,
    isRecurrenceMaster: event.isRecurrenceMaster,
    transparency: event.transparency,
    sequence: event.sequence,
    remindersJson: serializeCalendarReminderPolicy(event.reminders),
    origin: "remote",
  };
}

async function deleteMissingRemoteEventsWithDb(
  db: Database,
  input: Parameters<typeof reconcileCalendarEventsRange>[0],
): Promise<void> {
  const identities = [...new Set(input.events.map((event) => event.instanceId ?? event.remoteEventId))];
  const params: unknown[] = [input.accountId, input.calendarId, input.rangeStart, input.rangeEnd];
  const keepClause = identities.length > 0
    ? `AND google_event_id NOT IN (${identities.map((_, index) => `$${index + 5}`).join(", ")})`
    : "";
  params.push(...identities);
  await db.execute(
    `DELETE FROM calendar_events
     WHERE account_id = $1 AND calendar_id = $2
       AND start_time < $4 AND end_time > $3
       AND (origin IS NULL OR origin = 'remote')
       ${keepClause}`,
    params,
  );
}

async function removeMatchedProjectionsWithDb(
  db: Database,
  accountId: string,
  events: CalendarEventData[],
): Promise<void> {
  for (const event of events) {
    if (!event.uid) continue;
    await db.execute(
      `DELETE FROM calendar_events
       WHERE account_id = $1
         AND (origin = 'local_projection' OR (origin IS NULL AND calendar_id IS NULL AND google_event_id LIKE 'invite:%'))
         AND uid = $2 AND start_time = $3`,
      [accountId, event.uid, event.startTime],
    );
  }
}

export function normalizeCalendarEventRow(row: DbCalendarEvent): DbCalendarEvent {
  const normalizedOrigin: DbCalendarEvent["origin"] = row.origin
    ?? (row.calendar_id === null && row.google_event_id.startsWith("invite:") ? "local_projection" : "remote");
  const normalizedProjectionKey = row.projection_key
    ?? (normalizedOrigin === "local_projection" ? row.google_event_id : null);
  const normalizedProjectionStatus = row.projection_status
    ?? (normalizedOrigin === "local_projection" ? "pending" : null);
  let remindersJson = row.reminders_json;
  if (!remindersJson && row.ical_data) {
    try {
      remindersJson = serializeCalendarReminderPolicy(
        parseVEvent(row.ical_data, row.remote_event_id ?? row.google_event_id).reminders,
      );
    } catch {
      // Legacy malformed ICS remains readable; reminder policy stays unknown until refresh.
    }
  }
  const base = {
    ...row,
    origin: normalizedOrigin,
    projection_key: normalizedProjectionKey,
    projection_status: normalizedProjectionStatus,
    reminders_json: remindersJson,
  };
  if (row.time_kind) return base;

  const cacheKey = `${row.id}:${row.updated_at}:${row.ical_data ?? ""}`;
  const cached = legacyNormalizationCache.get(cacheKey);
  if (cached) return cached;

  let normalized: DbCalendarEvent;
  if (row.ical_data) {
    try {
      const event = parseVEvent(row.ical_data, row.remote_event_id ?? row.google_event_id);
      const semantic = semanticColumns(event.time);
      normalized = {
        ...base,
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
      cacheLegacyNormalization(cacheKey, normalized);
      return normalized;
    } catch {
      // Preserve a readable legacy row even when its raw ICS is malformed.
    }
  }
  if (row.is_all_day === 1) {
    normalized = {
      ...base,
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
    cacheLegacyNormalization(cacheKey, normalized);
    return normalized;
  }
  normalized = {
    ...base,
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
  cacheLegacyNormalization(cacheKey, normalized);
  return normalized;
}

export function clearCalendarEventNormalizationCache(): void {
  legacyNormalizationCache.clear();
}

function cacheLegacyNormalization(key: string, event: DbCalendarEvent): void {
  if (legacyNormalizationCache.size >= LEGACY_NORMALIZATION_CACHE_LIMIT) {
    const oldest = legacyNormalizationCache.keys().next().value;
    if (oldest) legacyNormalizationCache.delete(oldest);
  }
  legacyNormalizationCache.set(key, event);
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
