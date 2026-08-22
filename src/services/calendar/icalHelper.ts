import type { CalendarEventData, CalendarParticipationStatus, CreateEventInput, UpdateEventInput } from "./types";
import {
  parseCalendarEvent,
  parseCalendarEventsInRange,
  parseCalendarEventsInRangeDetailed,
  parseICalContentLine,
  parseICalDateTimeToInstant,
  unfoldICalLines,
  type CalendarParseOptions,
} from "./icalTimeMapping";
import {
  formatICalCalendarDate,
  formatICalWallDateTime,
  instantSecondsToWallDateTime,
  type CalendarEventTime,
} from "./domain";

export interface ParsedICalAttendee {
  email: string;
  displayName?: string;
  responseStatus?: string;
}

export interface ParsedCalendarInvitation {
  event: CalendarEventData;
  method: string | null;
  sequence: number;
  recurrenceId: string | null;
  recurrenceIdTime: number | null;
  timezoneId: string | null;
  timezoneWarning: boolean;
  isCancelled: boolean;
  attendees: ParsedICalAttendee[];
}

/**
 * Generate a VEVENT iCalendar string from event input.
 */
export function generateVEvent(event: CreateEventInput | UpdateEventInput, uid?: string): string {
  const eventUid = uid ?? crypto.randomUUID();
  const now = formatDateTimeUTC(new Date());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Office360//CalDAV Client//EN",
    "BEGIN:VEVENT",
    `UID:${eventUid}`,
    `DTSTAMP:${now}`,
  ];

  if (event.summary) {
    lines.push(`SUMMARY:${escapeICalText(event.summary)}`);
  }

  if (event.time) {
    lines.push(...serializeEventTime(event.time));
  } else if (event.startTime && event.endTime) {
    if (event.isAllDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatDateInput(event.startTime)}`);
      lines.push(`DTEND;VALUE=DATE:${formatDateInput(event.endTime)}`);
    } else {
      lines.push(`DTSTART:${formatDateTimeUTC(new Date(event.startTime))}`);
      lines.push(`DTEND:${formatDateTimeUTC(new Date(event.endTime))}`);
    }
  }

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICalText(event.description)}`);
  }

  if (event.location) {
    lines.push(`LOCATION:${escapeICalText(event.location)}`);
  }

  if ("attendees" in event && event.attendees) {
    for (const attendee of event.attendees) {
      lines.push(`ATTENDEE;RSVP=TRUE:mailto:${attendee.email}`);
    }
  }

  if (event.transparency) lines.push(`TRANSP:${event.transparency.toUpperCase()}`);
  if (event.sequence !== undefined) lines.push(`SEQUENCE:${event.sequence}`);

  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  return lines.join("\r\n");
}

/**
 * Parse a VEVENT from iCalendar data into CalendarEventData.
 */
export function parseVEvent(
  icalData: string,
  href?: string,
  options?: CalendarParseOptions,
): CalendarEventData {
  return parseCalendarEvent(icalData, href, options);
}

export function parseVEventsInRange(
  icalData: string,
  href: string | undefined,
  rangeStart: Date,
  rangeEnd: Date,
  options?: CalendarParseOptions,
): CalendarEventData[] {
  return parseCalendarEventsInRange(icalData, href, rangeStart, rangeEnd, options);
}

export { parseCalendarEventsInRangeDetailed as parseVEventsInRangeDetailed };

export function updateVEventFields(icalData: string, event: UpdateEventInput): string {
  let changedMaster = false;
  return icalData.replace(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi, (block) => {
    if (changedMaster || /(?:^|\r?\n)RECURRENCE-ID[;:]/i.test(block)) return block;
    changedMaster = true;
    let next = block;
    if (event.summary !== undefined) next = replaceEventProperty(next, "SUMMARY", escapeICalText(event.summary));
    if (event.description !== undefined) next = replaceEventProperty(next, "DESCRIPTION", escapeICalText(event.description));
    if (event.location !== undefined) next = replaceEventProperty(next, "LOCATION", escapeICalText(event.location));
    if (event.time) {
      for (const serialized of serializeEventTime(event.time)) {
        const parsed = parseICalContentLine(serialized)!;
        next = replaceEventProperty(next, parsed.name, parsed.value, serialized.slice(parsed.name.length, serialized.indexOf(":")));
      }
    } else {
      if (event.startTime !== undefined) next = replaceUpdatedDateProperty(next, "DTSTART", event.startTime, !!event.isAllDay);
      if (event.endTime !== undefined) next = replaceUpdatedDateProperty(next, "DTEND", event.endTime, !!event.isAllDay);
    }
    if (event.transparency !== undefined) next = replaceEventProperty(next, "TRANSP", event.transparency.toUpperCase());
    if (event.sequence !== undefined) next = replaceEventProperty(next, "SEQUENCE", String(event.sequence));
    return next;
  });
}

export function updateAttendeeParticipation(
  icalData: string,
  attendeeEmail: string,
  status: CalendarParticipationStatus,
): string {
  const partstat = status.toUpperCase();
  let updated = false;
  return icalData.replace(/(^|\r?\n)(ATTENDEE[^\r\n]*:mailto:([^\r\n]+))/gi, (match, prefix, line, email) => {
    if (updated || String(email).trim().toLowerCase() !== attendeeEmail.trim().toLowerCase()) return match;
    updated = true;
    const colon = String(line).indexOf(":");
    let params = String(line).slice(0, colon).replace(/;PARTSTAT=[^;:]*/i, "").replace(/;RSVP=[^;:]*/i, "");
    params += `;PARTSTAT=${partstat};RSVP=FALSE`;
    return `${prefix}${params}${String(line).slice(colon)}`;
  });
}

/**
 * Parse iTIP/iMIP invitation metadata while preserving the existing event shape.
 */
export function parseICalendarInvite(icalData: string, href?: string): ParsedCalendarInvitation {
  const lines = unfoldLines(icalData);
  const event = parseVEvent(icalData, href);
  const attendees = event.attendeesJson
    ? JSON.parse(event.attendeesJson) as ParsedICalAttendee[]
    : [];

  let method: string | null = null;
  let sequence = 0;
  let recurrenceId: string | null = null;
  let recurrenceIdTime: number | null = null;
  let timezoneId: string | null = null;
  let hasTimezoneParseRisk = false;

  for (const rawLine of lines) {
    const line = parseContentLine(rawLine);
    if (!line) continue;

    switch (line.name) {
      case "METHOD":
        method = line.value.toUpperCase();
        break;
      case "SEQUENCE":
        sequence = Number.parseInt(line.value, 10);
        if (!Number.isFinite(sequence)) sequence = 0;
        break;
      case "RECURRENCE-ID":
        recurrenceId = line.value;
        try {
          recurrenceIdTime = parseICalDateTimeToInstant(line.value, line.params);
        } catch {
          recurrenceIdTime = Number.NaN;
        }
        if (line.params.TZID) {
          timezoneId = line.params.TZID;
          hasTimezoneParseRisk ||= !isSupportedTimeZone(line.params.TZID);
        }
        hasTimezoneParseRisk ||= !Number.isFinite(recurrenceIdTime);
        break;
      case "DTSTART":
      case "DTEND":
        if (line.params.TZID) {
          timezoneId ??= line.params.TZID;
          hasTimezoneParseRisk ||= !isSupportedTimeZone(line.params.TZID);
        }
        break;
    }
  }

  const isCancelled = method === "CANCEL" || event.status.toLowerCase() === "cancelled";
  const timezoneWarning = hasTimezoneParseRisk
    || !Number.isFinite(event.startTime)
    || !Number.isFinite(event.endTime);

  return {
    event,
    method,
    sequence,
    recurrenceId,
    recurrenceIdTime,
    timezoneId,
    timezoneWarning,
    isCancelled,
    attendees,
  };
}

/** Unfold continuation lines (RFC 5545 §3.1) */
function unfoldLines(icalData: string): string[] {
  return unfoldICalLines(icalData);
}

function parseContentLine(line: string) {
  return parseICalContentLine(line);
}

function formatDateTimeUTC(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function replaceEventProperty(block: string, name: string, value: string, params = ""): string {
  const property = new RegExp(`(^|\\r?\\n)${name}(?:;[^:\\r\\n]*)?:[^\\r\\n]*`, "i");
  const replacement = `$1${name}${params}:${value}`;
  if (property.test(block)) return block.replace(property, replacement);
  return block.replace(/\r?\nEND:VEVENT$/i, `\r\n${name}${params}:${value}\r\nEND:VEVENT`);
}

function serializeEventTime(time: CalendarEventTime): string[] {
  if (time.kind === "all-day") {
    return [
      `DTSTART;VALUE=DATE:${formatICalCalendarDate(time.startDate)}`,
      `DTEND;VALUE=DATE:${formatICalCalendarDate(time.endDateExclusive)}`,
    ];
  }
  if (time.kind === "floating") {
    return [
      `DTSTART:${formatICalWallDateTime(time.start)}`,
      `DTEND:${formatICalWallDateTime(time.end)}`,
    ];
  }
  const start = time.start.tzid === "UTC"
    ? `DTSTART:${formatICalWallDateTime(time.start.wall)}Z`
    : `DTSTART;TZID=${time.start.tzid}:${formatICalWallDateTime(time.start.wall)}`;
  const end = time.end.tzid === "UTC"
    ? `DTEND:${formatICalWallDateTime(time.end.wall)}Z`
    : `DTEND;TZID=${time.end.tzid}:${formatICalWallDateTime(time.end.wall)}`;
  return [start, end];
}

function replaceUpdatedDateProperty(block: string, name: string, value: string, allDay: boolean): string {
  if (allDay) return replaceEventProperty(block, name, formatDateInput(value), ";VALUE=DATE");
  const current = unfoldLines(block).map(parseContentLine).find((line) => line?.name === name);
  const tzid = current?.params.TZID;
  if (tzid) {
    const instant = Math.floor(new Date(value).getTime() / 1000);
    const wall = instantSecondsToWallDateTime(instant, tzid);
    return replaceEventProperty(block, name, formatICalWallDateTime(wall), `;TZID=${tzid}`);
  }
  return replaceEventProperty(block, name, formatDateTimeUTC(new Date(value)));
}

function formatDateInput(value: string): string {
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!date) throw new Error(`Invalid all-day date: ${value}`);
  return `${date[1]}${date[2]}${date[3]}`;
}

function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function isSupportedTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}
