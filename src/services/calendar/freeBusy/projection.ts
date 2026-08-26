import {
  calendarDateFromUnixSecondsUtc,
  findCurrentAttendee,
  parseCalendarParticipants,
  zonedWallDateTimeToInstant,
  type AttendanceStatus,
  type CalendarEventTime,
  type ParticipantIdentityContext,
  type WallDateTime,
} from "../domain";
import type { CalendarEventData } from "../types";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { AvailabilityDiagnostic, BusyInterval, BusyType } from "./types";

/**
 * Minimal provider-neutral input for busy projection. It deliberately excludes summary,
 * description, location, attendee lists and raw ICS: busy time must be computable without
 * event details so the same code path is reusable for a privacy-limited remote response.
 */
export interface AvailabilitySourceEvent {
  time: CalendarEventTime;
  /** Compatibility instants, used when `time` is absent on legacy rows. */
  startInstant: number;
  endInstant: number;
  /** RFC 5545 `STATUS`: confirmed | tentative | cancelled. */
  eventStatus: string;
  /** RFC 5545 `TRANSP`. `null` means absent, which RFC 5545 defines as OPAQUE. */
  transparency: "opaque" | "transparent" | null;
  /** Attendance of the identity being asked about, when it is an attendee at all. */
  selfAttendance: AttendanceStatus | null;
  /** Unconfirmed local projection (CAL-104 `origin = 'local_projection'`). */
  provisional: boolean;
  /** The codec could not resolve the declared TZID to an IANA zone. */
  timeZoneUnresolved: boolean;
}

export interface BusyProjectionContext {
  /** Zone used to resolve all-day and floating values into instants. */
  timeZone: string;
}

export interface BusyProjectionResult {
  intervals: BusyInterval[];
  diagnostics: AvailabilityDiagnostic[];
}

function busyTypeFor(event: AvailabilitySourceEvent): BusyType {
  if (event.eventStatus.toLowerCase() === "tentative") return "tentative";
  if (event.selfAttendance === "tentative") return "tentative";
  // An optimistic local projection is not confirmed by any provider yet.
  if (event.provisional) return "tentative";
  return "busy";
}

function blocksTime(event: AvailabilitySourceEvent): boolean {
  if (event.eventStatus.toLowerCase() === "cancelled") return false;
  if (event.transparency === "transparent") return false;
  // Declining removes the event from the decliner's own availability.
  if (event.selfAttendance === "declined") return false;
  return true;
}

function calendarDateToWall(date: string): WallDateTime {
  const [year, month, day] = date.split("-").map(Number);
  return { year: year!, month: month!, day: day!, hour: 0, minute: 0, second: 0 };
}

/**
 * Project one event onto instants. All-day and floating values are resolved through the
 * CAL-102 IANA resolver, never through a host-local `Date`.
 */
export function projectSourceEvent(
  event: AvailabilitySourceEvent,
  context: BusyProjectionContext,
): BusyProjectionResult {
  if (!blocksTime(event)) return { intervals: [], diagnostics: [] };

  const busyType = busyTypeFor(event);
  const diagnostics: AvailabilityDiagnostic[] = [];
  if (event.provisional) diagnostics.push({ code: "pending-local-projection", severity: "info" });
  if (event.timeZoneUnresolved) diagnostics.push({ code: "unsupported-timezone", severity: "warning" });

  let start = event.startInstant;
  let end = event.endInstant;

  if (event.time.kind === "all-day") {
    // An all-day event blocks whole calendar dates in the effective zone, not UTC midnight.
    start = zonedWallDateTimeToInstant(calendarDateToWall(event.time.startDate), context.timeZone);
    end = zonedWallDateTimeToInstant(calendarDateToWall(event.time.endDateExclusive), context.timeZone);
  } else if (event.time.kind === "floating") {
    // No account/calendar timezone is stored, so the request zone is an assumption.
    // Surfaced as a diagnostic; the service downgrades reliability rather than guessing silently.
    start = zonedWallDateTimeToInstant(event.time.start, context.timeZone);
    end = zonedWallDateTimeToInstant(event.time.end, context.timeZone);
    diagnostics.push({ code: "floating-timezone-assumed", severity: "warning" });
  } else {
    start = event.time.start.instant;
    end = event.time.end.instant;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { intervals: [], diagnostics };
  }
  return { intervals: [{ start, end, busyType }], diagnostics };
}

export function projectSourceEvents(
  events: readonly AvailabilitySourceEvent[],
  context: BusyProjectionContext,
): BusyProjectionResult {
  const intervals: BusyInterval[] = [];
  const seen = new Set<string>();
  const diagnostics: AvailabilityDiagnostic[] = [];
  for (const event of events) {
    const projected = projectSourceEvent(event, context);
    intervals.push(...projected.intervals);
    for (const diagnostic of projected.diagnostics) {
      if (seen.has(diagnostic.code)) continue;
      seen.add(diagnostic.code);
      diagnostics.push(diagnostic);
    }
  }
  return { intervals, diagnostics };
}

/** Provider DTO -> busy projection input. */
export function calendarEventDataToSourceEvent(
  event: CalendarEventData,
  identity: ParticipantIdentityContext,
): AvailabilitySourceEvent {
  const self = findCurrentAttendee(event.attendees, identity);
  return {
    time: event.time,
    startInstant: event.startTime,
    endInstant: event.endTime,
    eventStatus: event.status,
    transparency: event.transparency,
    selfAttendance: self?.status ?? null,
    provisional: false,
    timeZoneUnresolved: event.timeZoneDiagnostic?.status === "unsupported-timezone",
  };
}

/** The `CalendarEventData[] -> BusyInterval[]` entry point named by the CAL-107 contract. */
export function projectEventsToBusyIntervals(
  events: readonly CalendarEventData[],
  identity: ParticipantIdentityContext,
  context: BusyProjectionContext,
): BusyProjectionResult {
  return projectSourceEvents(
    events.map((event) => calendarEventDataToSourceEvent(event, identity)),
    context,
  );
}

function parseStoredWall(value: string | null): WallDateTime | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6]),
  };
}

/** Cached row -> busy projection input, using the CAL-102 semantic columns when present. */
export function dbCalendarEventToSourceEvent(
  row: DbCalendarEvent,
  identity: ParticipantIdentityContext,
): AvailabilitySourceEvent {
  const self = findCurrentAttendee(
    parseCalendarParticipants(row.attendees_json, row.organizer_email).attendees,
    identity,
  );
  const wallStart = parseStoredWall(row.wall_start);
  const wallEnd = parseStoredWall(row.wall_end);

  let time: CalendarEventTime;
  if (row.time_kind === "all-day" || (row.time_kind === null && row.is_all_day === 1)) {
    time = {
      kind: "all-day",
      startDate: calendarDateFromUnixSecondsUtc(row.start_time),
      endDateExclusive: row.end_date_exclusive ?? calendarDateFromUnixSecondsUtc(row.end_time),
    };
  } else if (row.time_kind === "floating" && wallStart && wallEnd) {
    time = { kind: "floating", start: wallStart, end: wallEnd };
  } else {
    const tzid = row.tzid ?? "UTC";
    time = {
      kind: "timed-zoned",
      start: { wall: wallStart ?? { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 }, tzid, instant: row.start_time },
      end: { wall: wallEnd ?? { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 }, tzid, instant: row.end_time },
    };
  }

  return {
    time,
    startInstant: row.start_time,
    endInstant: row.end_time,
    eventStatus: row.status,
    transparency: row.transp,
    selfAttendance: self?.status ?? null,
    provisional: row.origin === "local_projection" && row.projection_status === "pending",
    timeZoneUnresolved: false,
  };
}
