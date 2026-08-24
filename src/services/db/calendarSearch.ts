import { getDb, selectFirstBy } from "./connection";
import { normalizeCalendarEventRow, type DbCalendarEvent } from "./calendarEvents";

export type CalendarSearchMatchField = "title" | "description" | "location" | "participant";

export interface CalendarSearchRow {
  event_id: string;
  event_resource_key: string;
  series_uid: string | null;
  occurrence_key: string | null;
  calendar_id: string;
  calendar_name: string | null;
  summary: string | null;
  location: string | null;
  start_time: number;
  end_time: number;
  is_all_day: number;
  matched_title: number;
  matched_description: number;
  matched_location: number;
  matched_participant: number;
}

export interface SearchCalendarEventRowsInput {
  accountId: string;
  calendarIds: readonly string[];
  query: string;
  rangeStart?: number;
  rangeEnd?: number;
  limit: number;
  now: number;
}

/**
 * Bounded local-cache search. Participant matching uses SQLite JSON traversal rather
 * than parsing every attendee envelope in JavaScript or matching raw JSON syntax.
 */
export async function searchCalendarEventRows(input: SearchCalendarEventRowsInput): Promise<CalendarSearchRow[]> {
  if (input.calendarIds.length === 0) return [];
  const db = await getDb();
  const calendarPlaceholders = input.calendarIds.map((_, index) => `$${index + 10}`).join(", ");
  const rangeStartClause = input.rangeStart === undefined ? "" : "AND e.end_time > $7";
  const rangeEndClause = input.rangeEnd === undefined ? "" : "AND e.start_time < $8";
  const patterns = searchPatterns(input.query);
  const textMatches = (column: string) => `(${patterns.map((_, index) => `${column} LIKE $${index + 2} ESCAPE '\\'`).join(" OR ")})`;

  return db.select<CalendarSearchRow[]>(
    `WITH matches AS (
       SELECT
         e.id AS event_id,
         COALESCE(e.remote_event_id, e.google_event_id) AS event_resource_key,
         e.series_uid,
         e.occurrence_key,
         e.calendar_id,
         c.display_name AS calendar_name,
         e.summary,
         e.location,
         e.start_time,
         e.end_time,
         e.is_all_day,
         ${textMatches("COALESCE(e.summary, '')")} AS matched_title,
         ${textMatches("COALESCE(e.description, '')")} AS matched_description,
         ${textMatches("COALESCE(e.location, '')")} AS matched_location,
         (
           ${textMatches("COALESCE(e.organizer_email, '')")}
           OR EXISTS (
             SELECT 1 FROM json_tree(CASE WHEN json_valid(e.attendees_json) THEN e.attendees_json ELSE NULL END) AS participant
             WHERE participant.type = 'text'
               AND participant.key IN ('value', 'normalizedEmail', 'displayName', 'email', 'uri')
               AND ${textMatches("CAST(participant.value AS TEXT)")}
           )
         ) AS matched_participant
       FROM calendar_events e
       JOIN calendars c ON c.id = e.calendar_id AND c.account_id = e.account_id
       WHERE e.account_id = $1
         AND e.calendar_id IN (${calendarPlaceholders})
         AND c.provider_presence IS NOT 'removed'
         AND lower(COALESCE(e.status, '')) <> 'cancelled'
         ${rangeStartClause}
         ${rangeEndClause}
     ), ranked AS (
       SELECT *,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(NULLIF(series_uid, ''), event_resource_key)
           ORDER BY
             CASE WHEN start_time >= $6 THEN 0 ELSE 1 END,
             CASE WHEN start_time >= $6 THEN start_time ELSE -start_time END ASC,
             event_id ASC
         ) AS occurrence_rank
       FROM matches
       WHERE matched_title OR matched_description OR matched_location OR matched_participant
     )
     SELECT event_id, event_resource_key, series_uid, occurrence_key, calendar_id, calendar_name,
            summary, location, start_time, end_time, is_all_day,
            matched_title, matched_description, matched_location, matched_participant
     FROM ranked
     WHERE occurrence_rank = 1
     ORDER BY
       (matched_title * 8 + matched_participant * 4 + matched_location * 2 + matched_description) DESC,
       CASE WHEN start_time >= $6 THEN 0 ELSE 1 END,
       CASE WHEN start_time >= $6 THEN start_time ELSE -start_time END ASC,
       event_id ASC
     LIMIT $9`,
    [
      input.accountId,
      ...patterns,
      input.now,
      input.rangeStart ?? null,
      input.rangeEnd ?? null,
      input.limit,
      ...input.calendarIds,
    ],
  );
}

function searchPatterns(query: string): [string, string, string, string] {
  const value = query.trim();
  const lower = value.toLocaleLowerCase();
  const upper = value.toLocaleUpperCase();
  const title = lower ? `${lower[0]!.toLocaleUpperCase()}${lower.slice(1)}` : lower;
  return [value, lower, upper, title].map((variant) => `%${escapeLike(variant)}%`) as [string, string, string, string];
}

export async function getCalendarEventForSearch(
  accountId: string,
  eventId: string,
  calendarIds: readonly string[],
): Promise<DbCalendarEvent | null> {
  if (calendarIds.length === 0) return null;
  const placeholders = calendarIds.map((_, index) => `$${index + 3}`).join(", ");
  const row = await selectFirstBy<DbCalendarEvent>(
    `SELECT e.* FROM calendar_events e
     JOIN calendars c ON c.id = e.calendar_id AND c.account_id = e.account_id
     WHERE e.account_id = $1 AND e.id = $2
       AND e.calendar_id IN (${placeholders})
       AND c.provider_presence IS NOT 'removed'
       AND lower(COALESCE(e.status, '')) <> 'cancelled'`,
    [accountId, eventId, ...calendarIds],
  );
  return row ? normalizeCalendarEventRow(row) : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
