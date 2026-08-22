import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { CalendarDate, CalendarEventTime, WallDateTime } from "@/services/calendar/domain";
import {
  addCalendarDays,
  addWallSeconds,
  calendarDateFromUnixSecondsUtc,
  calendarDateToUnixSeconds,
  zonedWallDateTimeToInstant,
} from "@/services/calendar/domain";
import type { UpdateEventInput } from "@/services/calendar/types";
import { SNAP_MINUTES } from "../timedGrid/constants";
import { snapMinutes } from "../timedGrid/geometry";
import { eventWallRange, updateInputFromTime } from "../timedGrid/timedEventMutation";
import { DEFAULT_TIMED_DURATION_MINUTES } from "./constants";

export type DateGridDraft =
  | { type: "shift"; deltaDays: number }
  | { type: "to-all-day"; startDate: CalendarDate }
  | { type: "to-timed"; startDate: CalendarDate; startMinutesFromMidnight: number };

export type DateGridApplyResult =
  | { ok: true; input: UpdateEventInput; time: CalendarEventTime; unchanged: boolean }
  | { ok: false; reason: "unsupported" };

export function calendarDateDiffDays(from: CalendarDate, to: CalendarDate): number {
  return (calendarDateToUnixSeconds(to) - calendarDateToUnixSeconds(from)) / 86400;
}

export function wallToCalendarDate(wall: WallDateTime): CalendarDate {
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

export function allDayRange(event: DbCalendarEvent): { startDate: CalendarDate; endDateExclusive: CalendarDate } {
  const startDate = calendarDateFromUnixSecondsUtc(event.start_time);
  const endDateExclusive = event.end_date_exclusive ?? calendarDateFromUnixSecondsUtc(event.end_time);
  return { startDate, endDateExclusive };
}

export function timedOccupiedRange(event: DbCalendarEvent): { startDate: CalendarDate; endDateExclusive: CalendarDate } {
  const { start, end } = eventWallRange(event);
  const startDate = wallToCalendarDate(start);
  const endDate = wallToCalendarDate(end);
  const midnight = end.hour === 0 && end.minute === 0 && end.second === 0;
  const endDateExclusive = midnight && endDate > startDate ? endDate : addCalendarDays(endDate, 1);
  return { startDate, endDateExclusive };
}

export function occupiedSpanDays(startDate: CalendarDate, endDateExclusive: CalendarDate): number {
  return Math.max(1, calendarDateDiffDays(startDate, endDateExclusive));
}

export function applyDateGridDraft(event: DbCalendarEvent, draft: DateGridDraft): DateGridApplyResult {
  if (draft.type === "shift") {
    return applyShift(event, draft.deltaDays);
  }
  if (draft.type === "to-all-day") {
    return applyToAllDay(event, draft.startDate);
  }
  return applyToTimed(event, draft.startDate, draft.startMinutesFromMidnight);
}

function applyShift(event: DbCalendarEvent, deltaDays: number): DateGridApplyResult {
  const days = Math.trunc(deltaDays);
  if (days === 0) {
    const time = currentTime(event);
    if (!time) return { ok: false, reason: "unsupported" };
    return { ok: true, unchanged: true, time, input: updateInputFromTime(time) };
  }
  if (isAllDay(event)) {
    const { startDate, endDateExclusive } = allDayRange(event);
    const time: CalendarEventTime = {
      kind: "all-day",
      startDate: addCalendarDays(startDate, days),
      endDateExclusive: addCalendarDays(endDateExclusive, days),
    };
    return { ok: true, unchanged: false, time, input: updateInputFromTime(time) };
  }
  const { start, end } = eventWallRange(event);
  const nextStart = addWallSeconds(start, days * 86400);
  const nextEnd = addWallSeconds(end, days * 86400);
  const time = buildTimedTime(event, nextStart, nextEnd);
  return { ok: true, unchanged: false, time, input: updateInputFromTime(time) };
}

function applyToAllDay(event: DbCalendarEvent, startDate: CalendarDate): DateGridApplyResult {
  const current = isAllDay(event) ? allDayRange(event) : timedOccupiedRange(event);
  const span = occupiedSpanDays(current.startDate, current.endDateExclusive);
  const time: CalendarEventTime = {
    kind: "all-day",
    startDate,
    endDateExclusive: addCalendarDays(startDate, span),
  };
  const unchanged = isAllDay(event)
    && current.startDate === startDate
    && current.endDateExclusive === time.endDateExclusive;
  return { ok: true, unchanged, time, input: updateInputFromTime(time) };
}

function applyToTimed(
  event: DbCalendarEvent,
  startDate: CalendarDate,
  startMinutesFromMidnight: number,
): DateGridApplyResult {
  const snapped = snapMinutes(startMinutesFromMidnight, SNAP_MINUTES);
  const start = wallOnDate(startDate, snapped);
  const end = addWallSeconds(start, DEFAULT_TIMED_DURATION_MINUTES * 60);
  if (event.time_kind === "floating") {
    const time: CalendarEventTime = { kind: "floating", start, end };
    return { ok: true, unchanged: false, time, input: updateInputFromTime(time) };
  }
  const tzid = event.tzid && event.tzid.length > 0 ? event.tzid : "UTC";
  const time: CalendarEventTime = {
    kind: "timed-zoned",
    start: { wall: start, tzid, instant: zonedWallDateTimeToInstant(start, tzid) },
    end: { wall: end, tzid, instant: zonedWallDateTimeToInstant(end, tzid) },
  };
  return { ok: true, unchanged: false, time, input: updateInputFromTime(time) };
}

function currentTime(event: DbCalendarEvent): CalendarEventTime | null {
  if (isAllDay(event)) {
    const range = allDayRange(event);
    return { kind: "all-day", startDate: range.startDate, endDateExclusive: range.endDateExclusive };
  }
  const { start, end } = eventWallRange(event);
  return buildTimedTime(event, start, end);
}

function buildTimedTime(event: DbCalendarEvent, start: WallDateTime, end: WallDateTime): CalendarEventTime {
  if (event.time_kind === "floating") {
    return { kind: "floating", start, end };
  }
  const tzid = event.tzid && event.tzid.length > 0 ? event.tzid : "UTC";
  return {
    kind: "timed-zoned",
    start: { wall: start, tzid, instant: zonedWallDateTimeToInstant(start, tzid) },
    end: { wall: end, tzid, instant: zonedWallDateTimeToInstant(end, tzid) },
  };
}

function isAllDay(event: DbCalendarEvent): boolean {
  return event.is_all_day === 1 || event.time_kind === "all-day";
}

function wallOnDate(date: CalendarDate, minutesFromMidnight: number): WallDateTime {
  const [year, month, day] = date.split("-").map(Number);
  const hour = Math.floor(minutesFromMidnight / 60);
  const minute = minutesFromMidnight - hour * 60;
  return { year: year!, month: month!, day: day!, hour, minute, second: 0 };
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0");
}
