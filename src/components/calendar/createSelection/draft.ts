import type { CalendarDate, CalendarEventTime, WallDateTime } from "@/services/calendar/domain";
import {
  addCalendarDays,
  addWallSeconds,
  instantSecondsToWallDateTime,
  zonedWallDateTimeToInstant,
} from "@/services/calendar/domain";
import { DEFAULT_TIMED_DURATION_MINUTES } from "../dateGrid/constants";
import { MINUTES_PER_DAY, MIN_DURATION_MINUTES } from "../timedGrid/constants";
import { clampMinutes, snapMinutes } from "../timedGrid/geometry";

export type GridCreateDraft =
  | {
      kind: "timed";
      date: CalendarDate;
      startMinutes: number;
      endMinutes: number;
    }
  | {
      kind: "all-day";
      startDate: CalendarDate;
      endDateExclusive: CalendarDate;
    };

export interface GridCreateFormValues {
  startTime: string;
  endTime: string;
  allDay: boolean;
  time: CalendarEventTime;
  attendees: string[];
}

/** Click-to-create: snap then apply the CAL-114 default timed duration (60 min). */
export function timedClickDraft(date: CalendarDate, rawMinutes: number): GridCreateDraft {
  const duration = DEFAULT_TIMED_DURATION_MINUTES;
  const snapped = clampMinutes(snapMinutes(rawMinutes), 0, MINUTES_PER_DAY - duration);
  return { kind: "timed", date, startMinutes: snapped, endMinutes: snapped + duration };
}

/**
 * Drag-to-create: reverse-safe, snap, clamp to MIN_DURATION (15).
 * Short drags are never zero-length; they are not converted to click.
 * Cross-day timed selection is the caller's job (clamp to origin column).
 */
export function timedDragDraft(
  date: CalendarDate,
  originMinutes: number,
  currentMinutes: number,
): GridCreateDraft {
  const first = snapMinutes(originMinutes);
  const second = snapMinutes(currentMinutes);
  let start = clampMinutes(Math.min(first, second), 0, MINUTES_PER_DAY - MIN_DURATION_MINUTES);
  let end = clampMinutes(Math.max(first, second), start + MIN_DURATION_MINUTES, MINUTES_PER_DAY);
  if (end - start < MIN_DURATION_MINUTES) {
    end = Math.min(MINUTES_PER_DAY, start + MIN_DURATION_MINUTES);
    start = end - MIN_DURATION_MINUTES;
  }
  return { kind: "timed", date, startMinutes: start, endMinutes: end };
}

export function allDayClickDraft(date: CalendarDate): GridCreateDraft {
  return { kind: "all-day", startDate: date, endDateExclusive: addCalendarDays(date, 1) };
}

export function toEventCreateInput(draft: GridCreateDraft, timeZone: string): GridCreateFormValues {
  if (draft.kind === "all-day") {
    const inclusiveEnd = addCalendarDays(draft.endDateExclusive, -1);
    return {
      startTime: draft.startDate,
      endTime: inclusiveEnd,
      allDay: true,
      time: {
        kind: "all-day",
        startDate: draft.startDate,
        endDateExclusive: draft.endDateExclusive,
      },
      attendees: [],
    };
  }

  const startResolved = resolveTimedWall(draft.date, draft.startMinutes, timeZone);
  let endResolved = resolveTimedWall(draft.date, draft.endMinutes, timeZone);
  if (endResolved.instant <= startResolved.instant) {
    const bumped = addWallSeconds(startResolved.wall, MIN_DURATION_MINUTES * 60);
    endResolved = resolveTimedWallFromWall(bumped, timeZone);
  }

  return {
    startTime: datetimeLocalFromWall(startResolved.wall),
    endTime: datetimeLocalFromWall(endResolved.wall),
    allDay: false,
    time: {
      kind: "timed-zoned",
      start: { wall: startResolved.wall, tzid: timeZone, instant: startResolved.instant },
      end: { wall: endResolved.wall, tzid: timeZone, instant: endResolved.instant },
    },
    attendees: [],
  };
}

export function eventTimeFromFormFields(input: {
  allDay: boolean;
  startTime: string;
  endTime: string;
  timeZone: string;
}): CalendarEventTime | null {
  if (input.allDay) {
    const startDate = datePart(input.startTime);
    const inclusiveEnd = datePart(input.endTime);
    if (!startDate || !inclusiveEnd || inclusiveEnd < startDate) return null;
    return {
      kind: "all-day",
      startDate,
      endDateExclusive: addCalendarDays(inclusiveEnd, 1),
    };
  }

  const startWall = parseDatetimeLocal(input.startTime);
  const endWall = parseDatetimeLocal(input.endTime);
  if (!startWall || !endWall) return null;
  const start = resolveTimedWallFromWall(startWall, input.timeZone);
  const end = resolveTimedWallFromWall(endWall, input.timeZone);
  if (end.instant <= start.instant) return null;
  return {
    kind: "timed-zoned",
    start: { wall: start.wall, tzid: input.timeZone, instant: start.instant },
    end: { wall: end.wall, tzid: input.timeZone, instant: end.instant },
  };
}

function resolveTimedWall(
  date: CalendarDate,
  minutes: number,
  timeZone: string,
): { wall: WallDateTime; instant: number } {
  return resolveTimedWallFromWall(wallFromDateMinutes(date, minutes), timeZone);
}

function resolveTimedWallFromWall(
  requested: WallDateTime,
  timeZone: string,
): { wall: WallDateTime; instant: number } {
  const instant = zonedWallDateTimeToInstant(requested, timeZone);
  return { wall: instantSecondsToWallDateTime(instant, timeZone), instant };
}

function wallFromDateMinutes(date: CalendarDate, minutes: number): WallDateTime {
  const [year, month, day] = date.split("-").map(Number);
  return addWallSeconds(
    { year: year!, month: month!, day: day!, hour: 0, minute: 0, second: 0 },
    minutes * 60,
  );
}

function datetimeLocalFromWall(wall: WallDateTime): string {
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

function parseDatetimeLocal(value: string): WallDateTime | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: 0,
  };
}

function datePart(value: string): CalendarDate | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1]! : null;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}
