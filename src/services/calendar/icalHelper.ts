import type { CalendarEventData, CreateEventInput, UpdateEventInput } from "./types";

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

interface ICalContentLine {
  name: string;
  params: Record<string, string>;
  rawName: string;
  value: string;
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

  if (event.startTime && event.endTime) {
    if (event.isAllDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(new Date(event.startTime))}`);
      lines.push(`DTEND;VALUE=DATE:${formatDateOnly(new Date(event.endTime))}`);
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

  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  return lines.join("\r\n");
}

/**
 * Parse a VEVENT from iCalendar data into CalendarEventData.
 */
export function parseVEvent(icalData: string, href?: string): CalendarEventData {
  const lines = unfoldLines(icalData);

  let uid: string | null = null;
  let summary: string | null = null;
  let description: string | null = null;
  let location: string | null = null;
  let dtstart: string | null = null;
  let dtend: string | null = null;
  let status = "confirmed";
  let organizerEmail: string | null = null;
  let isAllDay = false;
  const attendees: { email: string; displayName?: string; responseStatus?: string }[] = [];

  for (const line of lines) {
    const [nameWithParams, ...valueParts] = line.split(":");
    if (!nameWithParams) continue;
    const value = valueParts.join(":");
    const nameParts = nameWithParams.split(";");
    const propName = nameParts[0]!.toUpperCase();
    const params = nameParts.slice(1).join(";").toUpperCase();

    switch (propName) {
      case "UID":
        uid = value;
        break;
      case "SUMMARY":
        summary = unescapeICalText(value);
        break;
      case "DESCRIPTION":
        description = unescapeICalText(value);
        break;
      case "LOCATION":
        location = unescapeICalText(value);
        break;
      case "DTSTART":
        dtstart = value;
        if (params.includes("VALUE=DATE") && !params.includes("VALUE=DATE-TIME")) {
          isAllDay = true;
        }
        break;
      case "DTEND":
        dtend = value;
        break;
      case "STATUS":
        status = value.toLowerCase();
        break;
      case "ORGANIZER": {
        const mailto = value.match(/mailto:(.+)/i);
        if (mailto) organizerEmail = mailto[1]!;
        break;
      }
      case "ATTENDEE": {
        const attendeeMailto = value.match(/mailto:(.+)/i);
        if (attendeeMailto) {
          const cnMatch = nameWithParams.match(/CN=([^;]+)/i);
          const statusMatch = nameWithParams.match(/PARTSTAT=([^;]+)/i);
          attendees.push({
            email: attendeeMailto[1]!,
            displayName: cnMatch?.[1]?.replace(/^"(.*)"$/, "$1"),
            responseStatus: statusMatch?.[1]?.toLowerCase(),
          });
        }
        break;
      }
    }
  }

  const startTime = dtstart ? parseICalDateTime(dtstart, isAllDay) : 0;
  const endTime = dtend ? parseICalDateTime(dtend, isAllDay) : startTime + 3600;

  return {
    remoteEventId: href ?? uid ?? crypto.randomUUID(),
    uid,
    etag: null,
    summary,
    description,
    location,
    startTime,
    endTime,
    isAllDay,
    status,
    organizerEmail,
    attendeesJson: attendees.length > 0 ? JSON.stringify(attendees) : null,
    htmlLink: null,
    icalData,
  };
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
        recurrenceIdTime = parseICalDateTime(line.value, line.params.VALUE === "DATE");
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
  const raw = icalData.replace(/\r\n[ \t]/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return raw.split("\n").filter((l) => l.length > 0);
}

function parseContentLine(line: string): ICalContentLine | null {
  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) return null;

  const rawName = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);
  const [namePart, ...paramParts] = rawName.split(";");
  const name = namePart?.toUpperCase();
  if (!name) return null;

  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).toUpperCase();
    const rawValue = part.slice(eqIndex + 1);
    params[key] = rawValue.replace(/^"(.*)"$/, "$1");
  }

  return { name, params, rawName, value };
}

function formatDateTimeUTC(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function formatDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function unescapeICalText(text: string): string {
  return text
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseICalDateTime(value: string, isAllDay: boolean): number {
  if (isAllDay) {
    // Format: YYYYMMDD
    const y = parseInt(value.substring(0, 4), 10);
    const m = parseInt(value.substring(4, 6), 10) - 1;
    const d = parseInt(value.substring(6, 8), 10);
    return Math.floor(new Date(y, m, d).getTime() / 1000);
  }

  // Format: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  const isUTC = value.endsWith("Z");
  const cleaned = value.replace("Z", "");
  const y = parseInt(cleaned.substring(0, 4), 10);
  const m = parseInt(cleaned.substring(4, 6), 10) - 1;
  const d = parseInt(cleaned.substring(6, 8), 10);
  const h = parseInt(cleaned.substring(9, 11), 10);
  const min = parseInt(cleaned.substring(11, 13), 10);
  const s = parseInt(cleaned.substring(13, 15), 10) || 0;

  const date = isUTC
    ? new Date(Date.UTC(y, m, d, h, min, s))
    : new Date(y, m, d, h, min, s);

  return Math.floor(date.getTime() / 1000);
}

function isSupportedTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}
