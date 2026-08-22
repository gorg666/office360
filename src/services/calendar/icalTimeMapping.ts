import { rrulestr } from "rrule";
import type { CalendarEventData } from "./types";
import {
  addCalendarDays,
  addWallSeconds,
  calendarDateToUnixSeconds,
  createOccurrenceKey,
  formatWallDateTime,
  instantSecondsToWallDateTime,
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
import {
  decodeICalendar,
  type ICalendarEventComponent,
  type ICalendarPropertyData,
} from "./ical/codec";
import {
  resolveCalendarTimeZone,
  type ICalendarTimeZoneDefinition,
} from "./ical/timeZoneResolver";

export interface CalendarParseOptions {
  floatingTimeZone?: string;
}

export interface CalendarParseDiagnostics {
  unreadableComponentCount: number;
  unreadableObjectCount: number;
}

export interface CalendarParseResult {
  events: CalendarEventData[];
  diagnostics: CalendarParseDiagnostics;
}

export type ICalContentLine = ICalendarPropertyData;

interface ParsedTemporalValue {
  kind: "timed-zoned" | "floating" | "all-day";
  wall?: WallDateTime;
  date?: CalendarDate;
  tzid?: string;
  instant: number;
  unsupportedTzid?: string;
}

export function parseCalendarEvent(
  icalData: string,
  href?: string,
  options: CalendarParseOptions = {},
): CalendarEventData {
  const decoded = decodeICalendar(icalData);
  const component = decoded.events[0];
  if (!component) throw new Error("No readable VEVENT component");
  return parseCalendarEventComponent(component, icalData, href, options, decoded.timeZones);
}

function parseCalendarEventComponent(
  component: ICalendarEventComponent,
  icalData: string,
  href: string | undefined,
  options: CalendarParseOptions,
  timeZones: readonly ICalendarTimeZoneDefinition[],
): CalendarEventData {
  const lines = component.properties;
  const uid = firstValue(lines, "UID");
  const startLine = firstLine(lines, "DTSTART") ?? {
    name: "DTSTART",
    parameters: {},
    valueType: "DATE-TIME",
    values: ["19700101T000000Z"],
  };
  const start = parseTemporalValue(startLine, options, timeZones);
  const durationSeconds = parseICalDuration(firstValue(lines, "DURATION"))
    ?? (start.kind === "all-day" ? 86400 : 3600);
  const endLine = firstLine(lines, "DTEND");
  const end = endLine ? parseTemporalValue(endLine, options, timeZones) : addTemporalDuration(start, durationSeconds, options);
  const time = createEventTime(start, end);
  const recurrenceIdLine = firstLine(lines, "RECURRENCE-ID");
  const recurrenceIdentity = recurrenceIdLine
    ? temporalToIdentity(parseTemporalValue(recurrenceIdLine, options, timeZones))
    : null;
  const attendees = lines.filter((line) => line.name === "ATTENDEE").flatMap((line) => {
    const email = firstPropertyValue(line)?.match(/^mailto:(.+)$/i)?.[1]?.trim();
    if (!email) return [];
    const displayName = firstParameter(line, "CN");
    return [{
      email,
      ...(displayName ? { displayName } : {}),
      ...(firstParameter(line, "PARTSTAT") ? { responseStatus: firstParameter(line, "PARTSTAT")!.toLowerCase() } : {}),
      ...(firstParameter(line, "ROLE") ? { role: firstParameter(line, "ROLE") } : {}),
      ...(firstParameter(line, "CUTYPE") ? { calendarUserType: firstParameter(line, "CUTYPE") } : {}),
      ...(firstParameter(line, "RSVP") ? { rsvp: firstParameter(line, "RSVP")!.toUpperCase() === "TRUE" } : {}),
      ...(firstParameter(line, "SENT-BY") ? { sentBy: firstParameter(line, "SENT-BY") } : {}),
      ...(parameterValues(line, "DELEGATED-TO").length > 0 ? { delegatedTo: parameterValues(line, "DELEGATED-TO") } : {}),
      ...(parameterValues(line, "DELEGATED-FROM").length > 0 ? { delegatedFrom: parameterValues(line, "DELEGATED-FROM") } : {}),
    }];
  });
  const participants = attendees.map((attendee) => participantRefFromEmail(attendee.email, attendee.displayName));
  const organizerEmail = firstValue(lines, "ORGANIZER")?.match(/^mailto:(.+)$/i)?.[1]?.trim() ?? null;
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
    summary: firstValue(lines, "SUMMARY"),
    description: firstValue(lines, "DESCRIPTION"),
    location: firstValue(lines, "LOCATION"),
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
    ...((start.unsupportedTzid ?? end.unsupportedTzid) ? {
      timeZoneDiagnostic: {
        status: "unsupported-timezone" as const,
        originalTzid: (start.unsupportedTzid ?? end.unsupportedTzid)!,
      },
    } : {}),
  };
}

export function parseCalendarEventsInRange(
  icalData: string,
  href: string | undefined,
  rangeStart: Date,
  rangeEnd: Date,
  options: CalendarParseOptions = {},
): CalendarEventData[] {
  return parseCalendarEventsInRangeDetailed(icalData, href, rangeStart, rangeEnd, options).events;
}

export function parseCalendarEventsInRangeDetailed(
  icalData: string,
  href: string | undefined,
  rangeStart: Date,
  rangeEnd: Date,
  options: CalendarParseOptions = {},
): CalendarParseResult {
  const decoded = decodeICalendar(icalData);
  const diagnostics: CalendarParseDiagnostics = {
    unreadableComponentCount: decoded.unreadableComponentCount,
    unreadableObjectCount: decoded.unreadableObjectCount,
  };
  const parsed: ParsedEventComponent[] = [];
  for (const component of decoded.events) {
    try {
      parsed.push({
        component,
        lines: component.properties,
        event: parseCalendarEventComponent(component, icalData, href, options, decoded.timeZones),
        recurrenceId: firstLine(component.properties, "RECURRENCE-ID"),
      });
    } catch {
      diagnostics.unreadableComponentCount += 1;
    }
  }
  if (parsed.length === 0) return { events: [], diagnostics };

  try {
    return { events: expandParsedEvents(parsed, icalData, href, rangeStart, rangeEnd, options), diagnostics };
  } catch {
    const master = parsed.find((item) => !item.recurrenceId) ?? parsed[0]!;
    diagnostics.unreadableComponentCount += 1;
    return {
      events: parsed.filter((item) => item !== master && !item.recurrenceId).map((item) => item.event),
      diagnostics,
    };
  }
}

interface ParsedEventComponent {
  component: ICalendarEventComponent;
  lines: ICalContentLine[];
  event: CalendarEventData;
  recurrenceId: ICalContentLine | null;
}

function expandParsedEvents(
  parsed: ParsedEventComponent[],
  icalData: string,
  href: string | undefined,
  rangeStart: Date,
  rangeEnd: Date,
  options: CalendarParseOptions,
): CalendarEventData[] {

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
    const safetyWindowMs = 3 * 86400000;
    const expansionStart = new Date(rangeStart.getTime() - Math.max(safetyWindowMs, duration * 1000));
    const expansionEnd = new Date(rangeEnd.getTime() + 3 * 86400000);
    for (const date of recurrence.between(expansionStart, expansionEnd, true)) {
      const wall = naiveDateToWallDateTime(date);
      candidateWalls.set(formatWallDateTime(wall), wall);
    }
  }

  for (const line of rdateLines) {
    for (const value of line.values.flatMap(splitPropertyValues)) {
      const wall = recurrenceValueToMasterWall({ ...line, values: [value] }, master.event.time, options);
      candidateWalls.set(formatWallDateTime(wall), wall);
    }
  }

  const exclusions = new Set(
    master.lines.filter((line) => line.name === "EXDATE").flatMap((line) =>
      line.values.flatMap(splitPropertyValues).map((value) => {
        const wall = recurrenceValueToMasterWall({ ...line, values: [value] }, master.event.time, options);
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
  timeZones: readonly ICalendarTimeZoneDefinition[] = [],
): number {
  return parseTemporalValue({
    name: "DATE",
    parameters: params,
    valueType: params.VALUE ?? "DATE-TIME",
    values: [value],
  }, options, timeZones).instant;
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

function parseTemporalValue(
  line: ICalContentLine,
  options: CalendarParseOptions,
  timeZones: readonly ICalendarTimeZoneDefinition[],
): ParsedTemporalValue {
  const value = firstPropertyValue(line) ?? "";
  const valueType = line.valueType.toUpperCase();
  const tzid = firstParameter(line, "TZID");
  if (valueType === "DATE" || /^\d{8}$/.test(value)) {
    if (tzid) throw new Error("VALUE=DATE must not include TZID");
    const date = parseCalendarDate(value);
    return { kind: "all-day", date, instant: calendarDateToUnixSeconds(date) };
  }
  const isUtc = value.endsWith("Z");
  const wall = parseWallDateTime(isUtc ? value.slice(0, -1) : value);
  if (isUtc) {
    return { kind: "timed-zoned", wall, tzid: "UTC", instant: zonedWallDateTimeToInstant(wall, "UTC") };
  }
  if (tzid) {
    const resolved = resolveCalendarTimeZone(tzid, timeZones);
    if (!resolved.resolvedTzid) {
      const floatingTimeZone = options.floatingTimeZone ?? "UTC";
      return { kind: "floating", wall, instant: projectFloatingWallTime(wall, floatingTimeZone), unsupportedTzid: tzid };
    }
    return {
      kind: "timed-zoned",
      wall,
      tzid: resolved.resolvedTzid,
      instant: zonedWallDateTimeToInstant(wall, resolved.resolvedTzid),
    };
  }
  const floatingTimeZone = options.floatingTimeZone ?? "UTC";
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
    const zone = options.floatingTimeZone ?? "UTC";
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
  const parsed = parseTemporalValue(line, options, []);
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
  const zone = options.floatingTimeZone ?? "UTC";
  return projectFloatingWallTime(time.start, zone);
}

function compatibilityEnd(time: CalendarEventTime, options: CalendarParseOptions): number {
  if (time.kind === "all-day") return calendarDateToUnixSeconds(time.endDateExclusive);
  if (time.kind === "timed-zoned") return time.end.instant;
  const zone = options.floatingTimeZone ?? "UTC";
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
  const line = firstLine(lines, name);
  return line ? firstPropertyValue(line) : null;
}

function splitPropertyValues(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function firstPropertyValue(line: ICalContentLine): string | null {
  return line.values[0] ?? null;
}

function firstParameter(line: ICalContentLine, name: string): string | undefined {
  const value = line.parameters[name];
  return Array.isArray(value) ? value[0] : value;
}

function parameterValues(line: ICalContentLine, name: string): string[] {
  const value = line.parameters[name];
  if (!value) return [];
  return Array.isArray(value) ? value : value.split(",").map((item) => item.trim()).filter(Boolean);
}
