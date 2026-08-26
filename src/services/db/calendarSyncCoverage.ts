import type Database from "@tauri-apps/plugin-sql";
import { getDb } from "./connection";

export type CalendarCoverageState = "partial" | "complete";

export interface CalendarRangeCoverage {
  state: "never-synced" | "partial" | "complete";
  lastSuccessfulSync: number | null;
}

interface CoverageRow {
  calendar_id: string;
  coverage_state: CalendarCoverageState;
  last_successful_sync: number | null;
}

export async function getCalendarRangeCoverage(
  accountId: string,
  calendarIds: string[],
  rangeStart: number,
  rangeEnd: number,
): Promise<CalendarRangeCoverage> {
  if (calendarIds.length === 0) return { state: "never-synced", lastSuccessfulSync: null };
  const db = await getDb();
  const placeholders = calendarIds.map((_, index) => `$${index + 4}`).join(", ");
  const rows = await db.select<CoverageRow[]>(
    `SELECT calendar_id, coverage_state, last_successful_sync
     FROM calendar_sync_coverage
     WHERE account_id = $1
       AND range_start <= $2 AND range_end >= $3
       AND calendar_id IN (${placeholders})`,
    [accountId, rangeStart, rangeEnd, ...calendarIds],
  );

  const completeCalendars = new Set(
    rows.filter((row) => row.coverage_state === "complete").map((row) => row.calendar_id),
  );
  const lastSuccessfulSync = rows.reduce<number | null>((latest, row) => {
    if (row.last_successful_sync === null) return latest;
    return latest === null ? row.last_successful_sync : Math.max(latest, row.last_successful_sync);
  }, null);
  if (calendarIds.every((calendarId) => completeCalendars.has(calendarId))) {
    return { state: "complete", lastSuccessfulSync };
  }
  return rows.length > 0
    ? { state: "partial", lastSuccessfulSync }
    : { state: "never-synced", lastSuccessfulSync: null };
}

export async function recordCalendarRangeCoverage(
  input: {
    accountId: string;
    calendarId: string;
    rangeStart: number;
    rangeEnd: number;
    state: CalendarCoverageState;
    unreadableComponentCount: number;
    unreadableObjectCount: number;
  },
  database?: Database,
): Promise<void> {
  const db = database ?? await getDb();
  await db.execute(
    `INSERT INTO calendar_sync_coverage (
       id, account_id, calendar_id, range_start, range_end, coverage_state,
       last_attempt_at, last_successful_sync, unreadable_component_count, unreadable_object_count
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       unixepoch(), CASE WHEN $6 = 'complete' THEN unixepoch() ELSE NULL END, $7, $8
     )
     ON CONFLICT(account_id, calendar_id, range_start, range_end) DO UPDATE SET
       coverage_state = CASE
         WHEN excluded.coverage_state = 'partial' AND calendar_sync_coverage.coverage_state = 'complete'
           THEN calendar_sync_coverage.coverage_state
         ELSE excluded.coverage_state
       END,
       last_attempt_at = unixepoch(),
       last_successful_sync = CASE
         WHEN excluded.coverage_state = 'complete' THEN unixepoch()
         ELSE calendar_sync_coverage.last_successful_sync
       END,
       unreadable_component_count = excluded.unreadable_component_count,
       unreadable_object_count = excluded.unreadable_object_count`,
    [
      crypto.randomUUID(), input.accountId, input.calendarId, input.rangeStart, input.rangeEnd,
      input.state, input.unreadableComponentCount, input.unreadableObjectCount,
    ],
  );
}
