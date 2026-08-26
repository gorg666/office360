import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import {
  calendarDateFromLocalDate,
  calendarDateFromUnixSecondsUtc,
  type CalendarDate,
} from "@/services/calendar/domain";

/** UI projection only: all-day membership is compared as dates, never as local-midnight instants. */
export function eventOccursOnDate(event: DbCalendarEvent, date: Date): boolean {
  if (event.time_kind === "all-day" || event.is_all_day === 1) {
    const target = calendarDateFromLocalDate(date);
    const start = calendarDateFromUnixSecondsUtc(event.start_time);
    const endExclusive = event.end_date_exclusive ?? calendarDateFromUnixSecondsUtc(event.end_time);
    return start <= target && target < endExclusive;
  }

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return event.start_time < dayEnd.getTime() / 1000 && event.end_time > dayStart.getTime() / 1000;
}

export function allDayStartDate(event: DbCalendarEvent): CalendarDate {
  return calendarDateFromUnixSecondsUtc(event.start_time);
}
