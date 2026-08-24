import type { CalendarDate } from "@/services/calendar/domain";
import { calendarDateFromLocalDate, instantSecondsToWallDateTime, type WallDateTime } from "@/services/calendar/domain";
import { minutesToY } from "./timedGrid/geometry";

export function wallDateTimeToCalendarDate(wall: WallDateTime): CalendarDate {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
}

export function nowInDisplayTimeZone(displayTimeZone: string, instantMs = Date.now()): WallDateTime {
  return instantSecondsToWallDateTime(Math.floor(instantMs / 1000), displayTimeZone);
}

export function minutesSinceMidnight(wall: WallDateTime): number {
  return wall.hour * 60 + wall.minute + wall.second / 60;
}

export function currentTimeTopPx(displayTimeZone: string, hourHeightPx: number, instantMs = Date.now()): number {
  return minutesToY(minutesSinceMidnight(nowInDisplayTimeZone(displayTimeZone, instantMs)), hourHeightPx);
}

export function indexOfTodayColumn(days: Date[], displayTimeZone: string, instantMs = Date.now()): number {
  const today = wallDateTimeToCalendarDate(nowInDisplayTimeZone(displayTimeZone, instantMs));
  return days.findIndex((day) => calendarDateFromLocalDate(day) === today);
}

export function isTodayInDisplayTimeZone(date: Date, displayTimeZone: string, instantMs = Date.now()): boolean {
  const today = wallDateTimeToCalendarDate(nowInDisplayTimeZone(displayTimeZone, instantMs));
  return calendarDateFromLocalDate(date) === today;
}
