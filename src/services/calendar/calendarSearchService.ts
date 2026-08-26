import { eventReadableCalendars } from "./calendarAccessService";
import { getCalendarsForAccount, type DbCalendar } from "@/services/db/calendars";
import {
  getCalendarEventForSearch,
  searchCalendarEventRows,
  type CalendarSearchMatchField,
  type SearchCalendarEventRowsInput,
} from "@/services/db/calendarSearch";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";

export interface CalendarSearchRequest {
  accountId: string;
  query: string;
  calendarIds?: readonly string[];
  range?: { start: number; end: number } | null;
  limit?: number;
  now?: number;
}

export interface CalendarSearchResult {
  eventId: string;
  eventResourceKey: string;
  seriesUid: string | null;
  occurrenceKey: string | null;
  calendarId: string;
  calendarName: string | null;
  title: string;
  location: string | null;
  startTime: number;
  endTime: number;
  isAllDay: boolean;
  matchedFields: readonly CalendarSearchMatchField[];
}

interface CalendarSearchDependencies {
  getCalendarsForAccount: typeof getCalendarsForAccount;
  searchRows: typeof searchCalendarEventRows;
  getEvent: typeof getCalendarEventForSearch;
}

const defaultDependencies: CalendarSearchDependencies = {
  getCalendarsForAccount,
  searchRows: searchCalendarEventRows,
  getEvent: getCalendarEventForSearch,
};

export class CalendarSearchService {
  constructor(private readonly dependencies: CalendarSearchDependencies = defaultDependencies) {}

  async search(request: CalendarSearchRequest): Promise<CalendarSearchResult[]> {
    const query = request.query.trim();
    if (query.length < 2) return [];
    const calendars = await this.readableCalendars(request.accountId, request.calendarIds);
    const limit = Math.min(100, Math.max(1, Math.trunc(request.limit ?? 30)));
    const input: SearchCalendarEventRowsInput = {
      accountId: request.accountId,
      calendarIds: calendars.map((calendar) => calendar.id),
      query,
      limit,
      now: request.now ?? Math.floor(Date.now() / 1000),
      ...(request.range ? { rangeStart: request.range.start, rangeEnd: request.range.end } : {}),
    };
    const rows = await this.dependencies.searchRows(input);
    return rows.map((row) => ({
      eventId: row.event_id,
      eventResourceKey: row.event_resource_key,
      seriesUid: row.series_uid,
      occurrenceKey: row.occurrence_key,
      calendarId: row.calendar_id,
      calendarName: row.calendar_name,
      title: row.summary?.trim() || "Без названия",
      location: row.location,
      startTime: row.start_time,
      endTime: row.end_time,
      isAllDay: row.is_all_day === 1,
      matchedFields: matchedFields(row),
    }));
  }

  async resolveEvent(accountId: string, eventId: string): Promise<DbCalendarEvent | null> {
    const calendars = await this.readableCalendars(accountId);
    return this.dependencies.getEvent(accountId, eventId, calendars.map((calendar) => calendar.id));
  }

  private async readableCalendars(accountId: string, requestedIds?: readonly string[]): Promise<DbCalendar[]> {
    const readable = eventReadableCalendars(await this.dependencies.getCalendarsForAccount(accountId));
    if (!requestedIds) return readable;
    const requested = new Set(requestedIds);
    return readable.filter((calendar) => requested.has(calendar.id));
  }
}

export const calendarSearchService = new CalendarSearchService();

function matchedFields(row: Awaited<ReturnType<typeof searchCalendarEventRows>>[number]): CalendarSearchMatchField[] {
  const fields: CalendarSearchMatchField[] = [];
  if (row.matched_title) fields.push("title");
  if (row.matched_description) fields.push("description");
  if (row.matched_location) fields.push("location");
  if (row.matched_participant) fields.push("participant");
  return fields;
}
