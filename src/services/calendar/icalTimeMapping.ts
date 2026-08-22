import { rrulestr } from "rrule";
import type { CalendarEventData } from "./types";
import {
  addCalendarDays,
  addWallSeconds,
  calendarDateToUnixSeconds,
  createOccurrenceKey,
  formatWallDateTime,
  instantSecondsToWallDateTime,
  isSupportedIanaTimeZone,
  naiveDateToWallDateTime,
  parseCalendarDate,
  parseWallDateTime,
  participantRefFromEmail,
  projectFloatingWallTime,
  wallDateTimeToNaiveDate,
  zonedWallDateTimeToInstant,
  type CalendarDate,
  type CalendarEventTime,
  type OccurrenceIdentity,
  type WallDateTime,
} from "./domain";

export interface CalendarParseOptions {
  floatingTimeZone?: string;
}

export interface ICalContentLine {
  name: string;
  params: Record<string, string>;
  rawName: string;
  value: string;
}

interface ParsedTemporalValue {
  kind: "timed-zoned" | "floating" | "all-day";
  wall?: WallDateTime;
  date?: CalendarDate;
  tzid?: string;
  instant: number;
}

export function parseCalendarEvent(
  icalData: string,
  href?: string,
  options: CalendarParseOptions = {},
): CalendarEventData {
  const lines = unfoldICalLines(icalData).map(parseICalContentLine).filter(isPresent);
  const uid = firstValue(lines, "UID");
  const startLine = firstLine(lines, "DTSTART") ?? {
    name: "DTSTART",
    params: {},
    rawName: "DTSTART",
    value: "19700101T000000Z",
  };
  const start = parseTemporalValue(startLine, options);
  const durationSeconds = parseICalDuration(firstValue(lines, "DURATION"))
    ?? (start.kind === "all-day" ? 86400 : 3600);
  const endLine = firstLine(lines, "DTEND");
  const end = endLine ? parseTemporalValue(endLine, options) : addTemporalDuration(start, durationSeconds, options);
  const time = createEventTime(start, end);
  const recurrenceIdLine = firstLine(lines, "RECURRENCE-ID");
  const recurrenceIdentity = recurrenceIdLine
    ? temporalToIdentity(parseTemporalValue(recurrenceIdLine, options))
    : null;
  const attendees = lines.filter((line) => line.name === "ATTENDEE").flatMap((line) => {
    const email = line.value.match(/^mailto:(.+)$/i)?.[1]?.trim();
    if (!email) return [];
    const displayName = line.params.CN;
    return [{
      email,
      ...(displayName ? { displayName } : {}),
      ...(line.params.PARTSTAT ? { responseStatus: line.params.PARTSTAT.toLowerCase() } : {}),
    }];
  });
  const participants = attendees.map((attendee) => participantRefFromEmail(attendee.email, attendee.displayName));
  const organizerEmail = firstLine(lines, "ORGANIZER")?.value.match(/^mailto:(.+)$/i)?.[1]?.trim() ?? null;
  const rule = firstValue(lines, "RRULE");
  const sequence = Number.parseInt(firstValue(lines, "SEQUENCE") ?? "0", 10);
  const transparencyValue = firstValue(lines, "TRANSP")?.toLowerCase();
  const transparency = transparencyValue === "opaque" || transparencyValue === "transparent"
    ? transparencyValue
    : null;

  return {
    remoteEventId: href ?? uid ?? crypto.randomUUID(),
    uid,
    etag: null,
    summary: unescapeICalText(firstValue(lines, "SUMMARY")),
    description: unescapeICalText(firstValue(lines, "DESCRIPTION")),
    location: unescapeICalText(firstValue(lines, "LOCATION")),
    startTime: compatibilityStart(time, options),
    endTime: compatibilityEnd(time, options),
    isAllDay: time.kind === "all-day",
    status: (firstValue(lines, "STATUS") ?? "confirmed").toLowerCase(),
    organizerEmail,
    attendeesJson: attendees.length > 0 ? JSON.stringify(attendees) : null,
    htmlLink: null,
    icalData,
    time,
    seriesUid: uid,
    occurrenceKey: uid && recurrenceIdentity ? createOccurrenceKey(uid, recurrenceIdentity) : null,
    isRecurrenceMaster: Boolean(rule) && !recurrenceIdLine,
    transparency,
    sequence: Number.isFinite(sequence) ? sequence : 0,
    participants,
  };
}

export function parseCalendarEventsInRange(
  icalData: string,
  href: string | undefined,
  rangeStart: Date,
  rangeEnd: Date,
  options: CalendarParseOptions = {},
): CalendarEventData[] {
  const parsed = extractVEventBlocks(icalData).map((block) => {
    const lines = unfoldICalLines(block).map(parseICalContentLine).filter(isPresent);
    return {
      block,
      lines,
      event: parseCalendarEvent(wrapVEvent(block), href, options),
      recurrenceId: firstLine(lines, "RECURRENCE-ID"),
    };
  });
  if (parsed.length === 0) return [];

  const master = parsed.find((item) => !item.recurrenceId) ?? parsed[0]!;
  const rule = firstValue(master.lines, "RRULE");
  const rdateLines = master.lines.filter((line) => line.name === "RDATE");
  if (!rule && rdateLines.length === 0) return parsed.map((item) => item.event);

  const seriesUid = master.event.seriesUid ?? master.event.uid ?? href ?? master.event.remoteEventId;
  const duration = eventWallDurationSeconds(master.event.time);
  const masterWall = eventStartWall(master.event.time);
  const candidateWalls = new Map<string, WallDateTime>();
  candidateWalls.set(formatWallDateTime(masterWall), masterWall);

  if (rule) {
    const recurrence = rrulestr(rule, { dtstart: wallDateTimeToNaiveDate(masterWall) });
    const expansionStart = new Date(rangeStart.getTime() - 3 * 86400000);
    const expansionEnd = new Date(rangeEnd.getTime() + 3 * 86400000);
    for (const date of recurrence.between(expansionStart, expansionEnd, true)) {
      const wall = naiveDateToWallDateTime(date);
      candidateWalls.set(formatWallDateTime(wall), wall);
    }
  }

  for (const line of rdateLines) {
    for (const value of splitPropertyValues(line.value)) {
      const wall = recurrenceValueToMasterWall({ ...line, value }, master.event.time, options);
      candidateWalls.set(formatWallDateTime(wall), wall);
    }
  }

  const exclusions = new Set(
    master.lines.filter((line) => line.name === "EXDATE").flatMap((line) =>
      splitPropertyValues(line.value).map((value) => {
        const wall = recurrenceValueToMasterWall({ ...line, value }, master.event.time, options);
        return createOccurrenceKey(seriesUid, identityForMasterWall(master.event.time, wall));
      }),
    ),
  );
  const overrides = new Map<string, CalendarEventData>();
  for (const item of parsed) {
    if (!item.recurrenceId) continue;
    const wall = recurrenceValueToMasterWall(item.recurrenceId, master.event.time, options);
    overrides.set(createOccurrenceKey(seriesUid, identityForMasterWall(master.event.time, wall)), item.event);
  }

  return [...candidateWalls.values()].flatMap((wall) => {
    const occurrenceKey = createOccurrenceKey(seriesUid, identityForMasterWall(master.event.time, wall));
    if (exclusions.has(occurrenceKey)) return [];
    const override = overrides.get(occurrenceKey);
    if (override?.status === "cancelled") return [];
    const event = override ?? materializeOccurrence(master.event, wall, duration, options);
    const normalized = {
      ...event,
      instanceId: `${href ?? seriesUid}::${occurrenceKey}`,
      remoteEventId: href ?? master.event.remoteEventId,
      etag: master.event.etag,
      icalData,
      seriesUid,
      occurrenceKey,
      isRecurrenceMaster: false,
    };
    return normalized.startTime < rangeEnd.getTime() / 1000
      && normalized.endTime > rangeStart.getTime() / 1000
      ? [normalized]
      : [];
  });
}

export function parseICalDateTimeToInstant(
  value: string,
  params: Record<string, string> = {},
  options: CalendarParseOptions = {},
): number {
  return parseTemporalValue({ name: "DATE", params, rawName: "DATE", value }, options).instant;
}

export function parseICalDuration(value: string | null): number | null {
  if (!value) return null;
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!match) return null;
  return Number(match[1] ?? 0) * 604800
    + Number(match[2] ?? 0) * 86400
    + Number(match[3] ?? 0) * 3600
    + Number(match[4] ?? 0) * 60
    + Number(match[5] ?? 0);
}

export function unfoldICalLines(icalData: string): string[] {
  return icalData.replace(/\r?\n[ \t]/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .split("\n").filter((line) => line.length > 0);
}

export function parseICalContentLine(line: string): ICalContentLine | null {
  const colonIndex = findUnquotedCharacter(line, ":");
  if (colonIndex === -1) return null;
  const rawName = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);
  const [namePart, ...paramParts] = splitUnquoted(rawName, ";");
  const name = namePart?.toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eqIndex = findUnquotedCharacter(part, "=");
    if (eqIndex === -1) continue;
    params[part.slice(0, eqIndex).toUpperCase()] = part.slice(eqIndex + 1).replace(/^"(.*)"$/, "$1");
  }
  return { name, params, rawName, value };
}

function parseTemporalValue(line: ICalContentLine, options: CalendarParseOptions): ParsedTemporalValue {
  if (line.params.VALUE?.toUpperCase() === "DATE" || /^\d{8}$/.test(line.value)) {
    const date = parseCalendarDate(line.value);
    return { kind: "all-day", date, instant: calendarDateToUnixSeconds(date) };
  }
  const isUtc = line.value.endsWith("Z");
  const wall = parseWallDateTime(isUtc ? line.value.slice(0, -1) : line.value);
  if (isUtc) {
    return { kind: "timed-zoned", wall, tzid: "UTC", instant: zonedWallDateTimeToInstant(wall, "UTC") };
  }
  if (line.params.TZID) {
    if (!isSupportedIanaTimeZone(line.params.TZID)) {
      const floatingTimeZone = options.floatingTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      return { kind: "floating", wall, instant: projectFloatingWallTime(wall, floatingTimeZone) };
    }
    return {
      kind: "timed-zoned",
      wall,
      tzid: line.params.TZID,
      instant: zonedWallDateTimeToInstant(wall, line.params.TZID),
    };
  }
  const floatingTimeZone = options.floatingTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { kind: "floating", wall, instant: projectFloatingWallTime(wall, floatingTimeZone) };
}

function createEventTime(start: ParsedTemporalValue, end: ParsedTemporalValue): CalendarEventTime {
  if (start.kind === "all-day") {
    if (end.kind !== "all-day" || !start.date || !end.date) throw new Error("All-day DTSTART requires all-day DTEND");
    return { kind: "all-day", startDate: start.date, endDateExclusive: end.date };
  }
  if (start.kind === "floating") {
    if (end.kind !== "floating" || !start.wall || !end.wall) throw new Error("Floating DTSTART requires floating DTEND");
    return { kind: "floating", start: start.wall, end: end.wall };
  }
  if (end.kind !== "timed-zoned" || !start.wall || !end.wall || !start.tzid || !end.tzid) {
    throw new Error("Timed DTSTART requires timed DTEND");
  }
  return {
    kind: "timed-zoned",
    start: { wall: start.wall, tzid: start.tzid, instant: start.instant },
    end: { wall: end.wall, tzid: end.tzid, instant: end.instant },
  };
}

function addTemporalDuration(
  start: ParsedTemporalValue,
  durationSeconds: number,
  options: CalendarParseOptions,
): ParsedTemporalValue {
  if (start.kind === "all-day") {
    const date = addCalendarDays(start.date!, Math.max(1, Math.ceil(durationSeconds / 86400)));
    return { kind: "all-day", date, instant: calendarDateToUnixSeconds(date) };
  }
  const wall = addWallSeconds(start.wall!, durationSeconds);
  if (start.kind === "floating") {
    const zone = options.floatingTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return { kind: "floating", wall, instant: projectFloatingWallTime(wall, zone) };
  }
  return {
    kind: "timed-zoned",
    wall,
    tzid: start.tzid,
    instant: zonedWallDateTimeToInstant(wall, start.tzid!),
  };
}

function materializeOccurrence(
  master: CalendarEventData,
  wall: WallDateTime,
  duration: number,
  options: CalendarParseOptions,
): CalendarEventData {
  let time: CalendarEventTime;
  if (master.time.kind === "all-day") {
    const startDate = wallToCalendarDate(wall);
    time = { kind: "all-day", startDate, endDateExclusive: addCalendarDays(startDate, Math.max(1, duration / 86400)) };
  } else if (master.time.kind === "floating") {
    time = { kind: "floating", start: wall, end: addWallSeconds(wall, duration) };
  } else {
    const endWall = addWallSeconds(wall, duration);
    const tzid = master.time.start.tzid;
    time = {
      kind: "timed-zoned",
      start: { wall, tzid, instant: zonedWallDateTimeToInstant(wall, tzid) },
      end: { wall: endWall, tzid, instant: zonedWallDateTimeToInstant(endWall, tzid) },
    };
  }
  return { ...master, time, startTime: compatibilityStart(time, options), endTime: compatibilityEnd(time, options) };
}

function recurrenceValueToMasterWall(
  line: ICalContentLine,
  masterTime: CalendarEventTime,
  options: CalendarParseOptions,
): WallDateTime {
  const parsed = parseTemporalValue(line, options);
  if (masterTime.kind === "all-day") {
    if (parsed.date) return calendarDateToWall(parsed.date);
    return parsed.wall!;
  }
  if (masterTime.kind === "floating") return parsed.wall!;
  if (parsed.kind === "timed-zoned") {
    return instantSecondsToWallDateTime(parsed.instant, masterTime.start.tzid);
  }
  return parsed.wall!;
}

function identityForMasterWall(time: CalendarEventTime, wall: WallDateTime): OccurrenceIdentity {
  if (time.kind === "all-day") return { kind: "all-day", date: wallToCalendarDate(wall) };
  if (time.kind === "floating") return { kind: "floating", wall };
  return { kind: "timed-zoned", wall, tzid: time.start.tzid };
}

function temporalToIdentity(value: ParsedTemporalValue): OccurrenceIdentity {
  if (value.kind === "all-day") return { kind: "all-day", date: value.date! };
  if (value.kind === "floating") return { kind: "floating", wall: value.wall! };
  return { kind: "timed-zoned", wall: value.wall!, tzid: value.tzid! };
}

function eventStartWall(time: CalendarEventTime): WallDateTime {
  if (time.kind === "all-day") return calendarDateToWall(time.startDate);
  if (time.kind === "floating") return time.start;
  return time.start.wall;
}

function eventWallDurationSeconds(time: CalendarEventTime): number {
  if (time.kind === "all-day") {
    return calendarDateToUnixSeconds(time.endDateExclusive) - calendarDateToUnixSeconds(time.startDate);
  }
  const start = time.kind === "floating" ? time.start : time.start.wall;
  const end = time.kind === "floating" ? time.end : time.end.wall;
  return Math.max(0, (wallDateTimeToNaiveDate(end).getTime() - wallDateTimeToNaiveDate(start).getTime()) / 1000);
}

function compatibilityStart(time: CalendarEventTime, options: CalendarParseOptions): number {
  if (time.kind === "all-day") return calendarDateToUnixSeconds(time.startDate);
  if (time.kind === "timed-zoned") return time.start.instant;
  const zone = options.floatingTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return projectFloatingWallTime(time.start, zone);
}

function compatibilityEnd(time: CalendarEventTime, options: CalendarParseOptions): number {
  if (time.kind === "all-day") return calendarDateToUnixSeconds(time.endDateExclusive);
  if (time.kind === "timed-zoned") return time.end.instant;
  const zone = options.floatingTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return projectFloatingWallTime(time.end, zone);
}

function calendarDateToWall(date: CalendarDate): WallDateTime {
  const [year, month, day] = date.split("-").map(Number);
  return { year: year!, month: month!, day: day!, hour: 0, minute: 0, second: 0 };
}

function wallToCalendarDate(wall: WallDateTime): CalendarDate {
  return `${String(wall.year).padStart(4, "0")}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
}

function firstLine(lines: ICalContentLine[], name: string): ICalContentLine | null {
  return lines.find((line) => line.name === name) ?? null;
}

function firstValue(lines: ICalContentLine[], name: string): string | null {
  return firstLine(lines, name)?.value ?? null;
}

function splitPropertyValues(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function extractVEventBlocks(icalData: string): string[] {
  return icalData.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi) ?? [];
}

function wrapVEvent(block: string): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${block}\r\nEND:VCALENDAR`;
}

function unescapeICalText(value: string | null): string | null {
  if (value === null) return null;
  return value.replace(/\\([nN,;\\])/g, (_match, escaped: string) => {
    if (escaped === "n" || escaped === "N") return "\n";
    return escaped;
  });
}

function findUnquotedCharacter(value: string, character: string): number {
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    else if (!quoted && value[index] === character) return index;
  }
  return -1;
}

function splitUnquoted(value: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    else if (!quoted && value[index] === separator) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
