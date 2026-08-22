export interface WallDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export type CalendarDate = string;

export interface ZonedDateTimeValue {
  wall: WallDateTime;
  tzid: string;
  instant: number;
}

export type CalendarEventTime =
  | {
      kind: "timed-zoned";
      start: ZonedDateTimeValue;
      end: ZonedDateTimeValue;
    }
  | {
      kind: "floating";
      start: WallDateTime;
      end: WallDateTime;
    }
  | {
      kind: "all-day";
      startDate: CalendarDate;
      endDateExclusive: CalendarDate;
    };

export const DST_DISAMBIGUATION_POLICY = {
  gap: "shift-forward" as const,
  overlap: "earlier" as const,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function parseWallDateTime(value: string): WallDateTime {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/.exec(value);
  if (!match) throw new Error(`Invalid iCalendar wall date-time: ${value}`);
  const wall = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  assertValidWallDateTime(wall);
  return wall;
}

export function parseCalendarDate(value: string): CalendarDate {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid iCalendar date: ${value}`);
  const wall = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 0,
    minute: 0,
    second: 0,
  };
  assertValidWallDateTime(wall);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function formatWallDateTime(wall: WallDateTime): string {
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}`;
}

export function formatICalWallDateTime(wall: WallDateTime): string {
  return `${pad(wall.year, 4)}${pad(wall.month)}${pad(wall.day)}T${pad(wall.hour)}${pad(wall.minute)}${pad(wall.second)}`;
}

export function formatICalCalendarDate(date: CalendarDate): string {
  return date.replaceAll("-", "");
}

export function wallDateTimeToNaiveDate(wall: WallDateTime): Date {
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second));
}

export function naiveDateToWallDateTime(date: Date): WallDateTime {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

export function addWallSeconds(wall: WallDateTime, seconds: number): WallDateTime {
  return naiveDateToWallDateTime(new Date(wallDateTimeToNaiveDate(wall).getTime() + seconds * 1000));
}

export function calendarDateToUnixSeconds(date: CalendarDate): number {
  const [year, month, day] = date.split("-").map(Number);
  return Math.floor(Date.UTC(year!, month! - 1, day!) / 1000);
}

export function calendarDateFromUnixSecondsUtc(instant: number): CalendarDate {
  const date = new Date(instant * 1000);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date((calendarDateToUnixSeconds(date) + days * 86400) * 1000);
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function calendarDateFromLocalDate(date: Date): CalendarDate {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function instantSecondsToWallDateTime(instant: number, tzid: string): WallDateTime {
  const parts = getFormatter(tzid).formatToParts(new Date(instant * 1000));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour: Number(value.hour),
    minute: Number(value.minute),
    second: Number(value.second),
  };
}

/** Resolve a wall time using the centralized gap/overlap policy. */
export function zonedWallDateTimeToInstant(wall: WallDateTime, tzid: string): number {
  if (!isSupportedIanaTimeZone(tzid)) throw new Error(`Unsupported IANA timezone: ${tzid}`);
  const direct = matchingInstants(wall, tzid);
  if (direct.length > 0) return direct[0]!;

  // A DST gap has no exact instant. Move to the first valid wall minute after it.
  for (let minutes = 1; minutes <= 180; minutes += 1) {
    const shifted = addWallSeconds(wall, minutes * 60);
    const candidates = matchingInstants(shifted, tzid);
    if (candidates.length > 0) return candidates[0]!;
  }
  throw new Error(`Unable to resolve wall time ${formatWallDateTime(wall)} in ${tzid}`);
}

export function projectFloatingWallTime(wall: WallDateTime, displayTimeZone: string): number {
  return zonedWallDateTimeToInstant(wall, displayTimeZone);
}

export function isSupportedIanaTimeZone(tzid: string): boolean {
  try {
    getFormatter(tzid);
    return true;
  } catch {
    return false;
  }
}

function matchingInstants(wall: WallDateTime, tzid: string): number[] {
  const naiveMs = wallDateTimeToNaiveDate(wall).getTime();
  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    offsets.add(offsetAt(naiveMs + hours * 3600000, tzid));
  }
  return [...new Set([...offsets].map((offset) => Math.floor((naiveMs - offset) / 1000)))]
    .filter((instant) => wallEquals(instantSecondsToWallDateTime(instant, tzid), wall))
    .sort((a, b) => a - b);
}

function offsetAt(instantMs: number, tzid: string): number {
  const wall = instantSecondsToWallDateTime(Math.floor(instantMs / 1000), tzid);
  return wallDateTimeToNaiveDate(wall).getTime() - Math.floor(instantMs / 1000) * 1000;
}

function getFormatter(tzid: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(tzid);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tzid,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatter.formatToParts(new Date(0));
  formatterCache.set(tzid, formatter);
  return formatter;
}

function wallEquals(left: WallDateTime, right: WallDateTime): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day
    && left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

function assertValidWallDateTime(wall: WallDateTime): void {
  const roundTrip = naiveDateToWallDateTime(wallDateTimeToNaiveDate(wall));
  if (!wallEquals(wall, roundTrip)) throw new Error(`Invalid wall date-time: ${formatWallDateTime(wall)}`);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}
