import type { CalendarEventData, CalendarParticipationStatus, CreateEventInput, UpdateEventInput } from "./types";
import { parseCalendarParticipants } from "./domain";
import {
  parseCalendarEvent,
  parseCalendarEventsInRange,
  parseCalendarEventsInRangeDetailed,
  parseICalDateTimeToInstant,
  type CalendarParseOptions,
} from "./icalTimeMapping";
import {
  decodeICalendar,
  serializeNewICalendarEvent,
  updateICalendarAttendee,
  updateICalendarEvent,
  updateICalendarOccurrence,
  excludeICalendarOccurrence,
  type ICalendarPropertyData,
} from "./ical/codec";
import { resolveCalendarTimeZone } from "./ical/timeZoneResolver";

export interface ParsedICalAttendee {
  email: string;
  displayName?: string;
  responseStatus?: string;
  role?: string;
  calendarUserType?: string;
  rsvp?: boolean;
  sentBy?: string;
  delegatedTo?: string[];
  delegatedFrom?: string[];
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

export function generateVEvent(event: CreateEventInput | UpdateEventInput, uid?: string): string {
  return serializeNewICalendarEvent(event, uid);
}

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
  return updateICalendarEvent(icalData, event);
}

export function updateVEventOccurrence(
  icalData: string,
  event: UpdateEventInput,
  seriesUid: string,
  identity: import("./domain").OccurrenceIdentity,
): string {
  return updateICalendarOccurrence(icalData, event, seriesUid, identity);
}

export function excludeVEventOccurrence(
  icalData: string,
  seriesUid: string,
  identity: import("./domain").OccurrenceIdentity,
): string {
  return excludeICalendarOccurrence(icalData, seriesUid, identity);
}

export function updateAttendeeParticipation(
  icalData: string,
  attendeeEmail: string,
  status: CalendarParticipationStatus,
): string {
  return updateICalendarAttendee(icalData, attendeeEmail, status);
}

export function parseICalendarInvite(icalData: string, href?: string): ParsedCalendarInvitation {
  const decoded = decodeICalendar(icalData);
  const component = decoded.events[0];
  if (!component) throw new Error("No readable VEVENT component");
  const event = parseVEvent(icalData, href);
  const attendees = parseCalendarParticipants(event.attendeesJson, event.organizerEmail).attendees.map((attendee) => ({
    email: attendee.participant.value,
    ...(attendee.participant.displayName ? { displayName: attendee.participant.displayName } : {}),
    ...(attendee.rawStatus ? { responseStatus: attendee.status } : {}),
    ...(attendee.rawRole ? { role: attendee.rawRole } : {}),
    ...(attendee.rawParticipantType ? { calendarUserType: attendee.rawParticipantType } : {}),
    ...(attendee.rsvpRequested !== null ? { rsvp: attendee.rsvpRequested } : {}),
    ...(attendee.sentBy ? { sentBy: participantUri(attendee.sentBy) } : {}),
    ...(attendee.delegatedTo.length ? { delegatedTo: attendee.delegatedTo.map(participantUri) } : {}),
    ...(attendee.delegatedFrom.length ? { delegatedFrom: attendee.delegatedFrom.map(participantUri) } : {}),
  }));
  const recurrenceIdProperty = firstProperty(component.properties, "RECURRENCE-ID");
  const recurrenceId = recurrenceIdProperty?.values[0] ?? null;
  let recurrenceIdTime: number | null = null;
  if (recurrenceId && recurrenceIdProperty) {
    try {
      recurrenceIdTime = parseICalDateTimeToInstant(
        recurrenceId,
        scalarParameters(recurrenceIdProperty.parameters),
        {},
        decoded.timeZones,
      );
    } catch {
      recurrenceIdTime = Number.NaN;
    }
  }
  const timezoneId = firstTimeZoneId(component.properties);
  const unsupportedTimeZone = timezoneId
    ? resolveCalendarTimeZone(timezoneId, decoded.timeZones).resolvedTzid === null
    : false;
  const sequence = Number.parseInt(firstValue(component.properties, "SEQUENCE") ?? "0", 10);
  const method = decoded.method?.toUpperCase() ?? null;
  const isCancelled = method === "CANCEL" || event.status.toLowerCase() === "cancelled";
  const timezoneWarning = Boolean(event.timeZoneDiagnostic)
    || unsupportedTimeZone
    || !Number.isFinite(event.startTime)
    || !Number.isFinite(event.endTime)
    || (recurrenceIdTime !== null && !Number.isFinite(recurrenceIdTime));

  return {
    event,
    method,
    sequence: Number.isFinite(sequence) ? sequence : 0,
    recurrenceId,
    recurrenceIdTime,
    timezoneId,
    timezoneWarning,
    isCancelled,
    attendees,
  };
}

function participantUri(participant: import("./domain").ParticipantRef): string {
  return participant.normalizedEmail ? `mailto:${participant.value}` : participant.value;
}

function firstProperty(properties: ICalendarPropertyData[], name: string): ICalendarPropertyData | null {
  return properties.find((property) => property.name === name) ?? null;
}

function firstValue(properties: ICalendarPropertyData[], name: string): string | null {
  return firstProperty(properties, name)?.values[0] ?? null;
}

function firstTimeZoneId(properties: ICalendarPropertyData[]): string | null {
  for (const name of ["RECURRENCE-ID", "DTSTART", "DTEND"]) {
    const property = firstProperty(properties, name);
    if (!property) continue;
    const value = property.parameters.TZID;
    if (Array.isArray(value)) return value[0] ?? null;
    if (value) return value;
  }
  return null;
}

function scalarParameters(parameters: Record<string, string | string[]>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parameters).flatMap(([name, value]) => {
      const scalar = Array.isArray(value) ? value[0] : value;
      return scalar === undefined ? [] : [[name, scalar]];
    }),
  );
}
