import {
  instantSecondsToWallDateTime,
  zonedWallDateTimeToInstant,
  type WallDateTime,
} from "../domain";
import type { AvailabilityInterval } from "../freeBusy";
import type { WorkingHours } from "./types";

const MINUTES_PER_DAY = 24 * 60;

/**
 * Overnight windows are rejected rather than silently ignored: a window that wraps midnight
 * changes what "a working day" means, and guessing would produce plausible-looking wrong slots.
 */
export function assertSupportedWorkingHours(hours: WorkingHours): void {
  if (!Number.isInteger(hours.startMinute) || !Number.isInteger(hours.endMinute)) {
    throw new Error("Working hours must use whole minutes from local midnight");
  }
  if (hours.startMinute < 0 || hours.endMinute > MINUTES_PER_DAY) {
    throw new Error("Working hours must fall inside a single local day");
  }
  if (hours.endMinute <= hours.startMinute) {
    throw new Error("Overnight working hours are not supported (endMinute must exceed startMinute)");
  }
  if (hours.workingDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error("Working days must be integers in 0 (Sunday) .. 6 (Saturday)");
  }
}

function dayOfWeek(date: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function addDays(date: { year: number; month: number; day: number }, days: number) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * 86400000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function wallAt(date: { year: number; month: number; day: number }, minuteOfDay: number): WallDateTime {
  // 1440 means "midnight ending the day", expressed as 00:00 of the next calendar date.
  const base = minuteOfDay >= MINUTES_PER_DAY ? addDays(date, 1) : date;
  const minute = minuteOfDay >= MINUTES_PER_DAY ? 0 : minuteOfDay;
  return { ...base, hour: Math.floor(minute / 60), minute: minute % 60, second: 0 };
}

/**
 * Working windows for one participant inside `range`, resolved through the CAL-102 IANA
 * resolver so DST transitions move the instants rather than the wall clock.
 */
export function workingIntervalsFor(
  hours: WorkingHours,
  range: AvailabilityInterval,
): AvailabilityInterval[] {
  assertSupportedWorkingHours(hours);
  if (range.end <= range.start) return [];
  const days = new Set(hours.workingDays);
  if (days.size === 0) return [];

  const first = addDays(instantSecondsToWallDateTime(range.start, hours.timeZone), -1);
  const last = addDays(instantSecondsToWallDateTime(range.end, hours.timeZone), 1);
  const lastKey = Date.UTC(last.year, last.month - 1, last.day);

  const intervals: AvailabilityInterval[] = [];
  let cursor = first;
  for (let guard = 0; guard < 400; guard += 1) {
    const cursorKey = Date.UTC(cursor.year, cursor.month - 1, cursor.day);
    if (cursorKey > lastKey) break;
    if (days.has(dayOfWeek(cursor))) {
      const start = zonedWallDateTimeToInstant(wallAt(cursor, hours.startMinute), hours.timeZone);
      const end = zonedWallDateTimeToInstant(wallAt(cursor, hours.endMinute), hours.timeZone);
      const clippedStart = Math.max(start, range.start);
      const clippedEnd = Math.min(end, range.end);
      if (clippedEnd > clippedStart) intervals.push({ start: clippedStart, end: clippedEnd });
    }
    cursor = addDays(cursor, 1);
  }
  return intervals;
}

/** True when the whole interval fits inside a single working window. */
export function fitsWithinWorkingIntervals(
  interval: AvailabilityInterval,
  workingIntervals: readonly AvailabilityInterval[],
): boolean {
  return workingIntervals.some(
    (window) => window.start <= interval.start && window.end >= interval.end,
  );
}
