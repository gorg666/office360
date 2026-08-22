import ICAL from "ical.js";
import type { CalendarParticipationStatus, CreateEventInput, UpdateEventInput } from "../types";
import { dedupeCalendarAttendees, normalizeCalendarReminderPolicy, normalizeParticipantEmail } from "../domain";
import {
  instantSecondsToWallDateTime,
  type CalendarEventTime,
  type OccurrenceIdentity,
  type WallDateTime,
} from "../domain";
import type { ICalendarTimeZoneDefinition } from "./timeZoneResolver";

export interface ICalendarPropertyData {
  name: string;
  valueType: string;
  parameters: Record<string, string | string[]>;
  values: string[];
}

export interface ICalendarEventComponent {
  properties: ICalendarPropertyData[];
  alarms: ICalendarAlarmComponent[];
  alarmDiagnostics: import("../domain").CalendarReminderDiagnostic[];
  serialized: string;
}

export interface ICalendarAlarmComponent {
  properties: ICalendarPropertyData[];
}

export interface DecodedICalendar {
  method: string | null;
  events: ICalendarEventComponent[];
  timeZones: ICalendarTimeZoneDefinition[];
  unreadableComponentCount: number;
  unreadableObjectCount: number;
}

export function decodeICalendar(source: string): DecodedICalendar {
  const structural = extractComponentBlocks(source, "VEVENT");
  const timeZoneStructural = extractComponentBlocks(source, "VTIMEZONE");
  let calendar: InstanceType<typeof ICAL.Component> | null = null;
  try {
    calendar = ICAL.Component.fromString(source);
  } catch {
    // A single malformed VEVENT must not make readable sibling components disappear.
  }

  if (calendar) {
    const components = calendar.name === "vevent" ? [calendar] : calendar.getAllSubcomponents("vevent");
    const events: ICalendarEventComponent[] = [];
    let unreadableComponentCount = structural.unreadableComponentCount + timeZoneStructural.unreadableComponentCount;
    for (const component of components) {
      try {
        events.push(decodeEvent(component));
      } catch {
        unreadableComponentCount += 1;
      }
    }
    return {
      method: calendar.name === "vcalendar" ? stringValue(calendar.getFirstPropertyValue("method")) : null,
      events,
      timeZones: calendar.name === "vcalendar" ? calendar.getAllSubcomponents("vtimezone").map(decodeTimeZone) : [],
      unreadableComponentCount,
      unreadableObjectCount: 0,
    };
  }

  const events: ICalendarEventComponent[] = [];
  let unreadableComponentCount = structural.unreadableComponentCount;
  for (const block of structural.blocks) {
    try {
      const wrapped = wrapComponents([block]);
      const event = ICAL.Component.fromString(wrapped).getFirstSubcomponent("vevent");
      if (!event) throw new Error("VEVENT missing after parse");
      events.push(decodeEvent(event));
    } catch {
      unreadableComponentCount += 1;
    }
  }

  const timeZones: ICalendarTimeZoneDefinition[] = [];
  for (const block of timeZoneStructural.blocks) {
    try {
      const wrapped = wrapComponents([block]);
      const component = ICAL.Component.fromString(wrapped).getFirstSubcomponent("vtimezone");
      if (component) timeZones.push(decodeTimeZone(component));
    } catch {
      unreadableComponentCount += 1;
    }
  }

  return {
    method: null,
    events,
    timeZones,
    unreadableComponentCount,
    unreadableObjectCount: events.length === 0 && !isCalendarEnvelope(source) ? 1 : 0,
  };
}

export function decodeICalendarProperty(source: string): ICalendarPropertyData {
  return decodeProperty(ICAL.Property.fromString(source));
}

export function serializeNewICalendarEvent(event: CreateEventInput | UpdateEventInput, uid?: string): string {
  const calendar = new ICAL.Component("vcalendar");
  calendar.addPropertyWithValue("version", "2.0");
  calendar.addPropertyWithValue("prodid", "-//Office360//CalDAV Client//EN");
  const component = new ICAL.Component("vevent");
  calendar.addSubcomponent(component);

  component.addPropertyWithValue("uid", uid ?? crypto.randomUUID());
  component.addPropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
  component.addPropertyWithValue("sequence", event.sequence ?? 0);
  if (event.summary) component.addPropertyWithValue("summary", event.summary);
  if (event.description) component.addPropertyWithValue("description", event.description);
  if (event.location) component.addPropertyWithValue("location", event.location);
  setEventTime(component, event);
  if (event.transparency) component.addPropertyWithValue("transp", event.transparency.toUpperCase());
  if (event.status) component.addPropertyWithValue("status", event.status.toUpperCase());

  if ("attendees" in event && event.attendees) {
    for (const attendee of dedupeCalendarAttendees(event.attendees)) {
      const property = new ICAL.Property("attendee");
      if (attendee.participant.displayName) property.setParameter("cn", attendee.participant.displayName);
      property.setParameter("role", roleToICal(attendee.role));
      property.setParameter("partstat", statusToICal(attendee.status));
      property.setParameter("cutype", typeToICal(attendee.participantType));
      property.setParameter("rsvp", attendee.rsvpRequested === false ? "FALSE" : "TRUE");
      if (attendee.sentBy) property.setParameter("sent-by", participantUri(attendee.sentBy));
      if (attendee.delegatedTo.length > 0) property.setParameter("delegated-to", attendee.delegatedTo.map(participantUri));
      if (attendee.delegatedFrom.length > 0) property.setParameter("delegated-from", attendee.delegatedFrom.map(participantUri));
      property.setValue(participantUri(attendee.participant));
      component.addProperty(property);
    }
  }
  if (event.organizer) {
    const property = new ICAL.Property("organizer");
    if (event.organizer.participant.displayName) property.setParameter("cn", event.organizer.participant.displayName);
    if (event.organizer.sentBy) property.setParameter("sent-by", participantUri(event.organizer.sentBy));
    property.setValue(participantUri(event.organizer.participant));
    component.addProperty(property);
  }
  if (event.reminders !== undefined) applyReminderChanges(component, event.reminders);
  return calendar.toString();
}

export function updateICalendarEvent(source: string, changes: UpdateEventInput): string {
  const calendar = ICAL.Component.fromString(source);
  const master = calendar.getAllSubcomponents("vevent")
    .find((component) => !component.hasProperty("recurrence-id"));
  if (!master) return source;

  applyEventChanges(master, changes);
  if (changes.recurrenceRule !== undefined) {
    master.removeAllProperties("rrule");
    if (changes.recurrenceRule !== null) {
      if (/\r|\n|^RRULE:/i.test(changes.recurrenceRule)) throw new Error("Invalid RRULE value");
      master.addPropertyWithValue("rrule", ICAL.Recur.fromString(changes.recurrenceRule));
    }
  }
  touchComponent(master, changes.sequence);
  return calendar.toString();
}

export function updateICalendarOccurrence(
  source: string,
  changes: UpdateEventInput,
  seriesUid: string,
  identity: OccurrenceIdentity,
): string {
  const calendar = ICAL.Component.fromString(source);
  const components = calendar.getAllSubcomponents("vevent");
  const master = components.find((component) => !component.hasProperty("recurrence-id"));
  if (!master || stringValue(master.getFirstPropertyValue("uid")) !== seriesUid) {
    throw new Error("Recurring series identity does not match CalDAV resource");
  }
  let occurrence = components.find((component) => recurrencePropertyMatches(component.getFirstProperty("recurrence-id"), identity));
  if (!occurrence) {
    occurrence = new ICAL.Component(structuredClone(master.jCal));
    occurrence.removeAllProperties("rrule");
    occurrence.removeAllProperties("rdate");
    occurrence.removeAllProperties("exdate");
    occurrence.addProperty(identityProperty("recurrence-id", identity));
    calendar.addSubcomponent(occurrence);
  }
  applyEventChanges(occurrence, changes);
  touchComponent(occurrence, changes.sequence);
  return calendar.toString();
}

export function excludeICalendarOccurrence(
  source: string,
  seriesUid: string,
  identity: OccurrenceIdentity,
): string {
  const calendar = ICAL.Component.fromString(source);
  const components = calendar.getAllSubcomponents("vevent");
  const master = components.find((component) => !component.hasProperty("recurrence-id"));
  if (!master || stringValue(master.getFirstPropertyValue("uid")) !== seriesUid) {
    throw new Error("Recurring series identity does not match CalDAV resource");
  }
  const override = components.find((component) => recurrencePropertyMatches(component.getFirstProperty("recurrence-id"), identity));
  if (override) calendar.removeSubcomponent(override);
  const excluded = master.getAllProperties("exdate").some((property) =>
    property.getValues().some((value) => recurrenceValueMatches(property, value, identity)),
  );
  if (!excluded) master.addProperty(identityProperty("exdate", identity));
  touchComponent(master);
  return calendar.toString();
}

function applyEventChanges(master: InstanceType<typeof ICAL.Component>, changes: UpdateEventInput): void {
  updateText(master, "summary", changes.summary);
  updateText(master, "description", changes.description);
  updateText(master, "location", changes.location);
  if (changes.time || changes.startTime !== undefined || changes.endTime !== undefined) {
    updateEventTime(master, changes);
  }
  if (changes.transparency !== undefined) {
    master.updatePropertyWithValue("transp", changes.transparency.toUpperCase());
  }
  if (changes.status !== undefined) {
    master.updatePropertyWithValue("status", changes.status.toUpperCase());
  }
  if (changes.attendees !== undefined) {
    master.removeAllProperties("attendee");
    for (const attendee of dedupeCalendarAttendees(changes.attendees)) {
      const property = new ICAL.Property("attendee");
      if (attendee.participant.displayName) property.setParameter("cn", attendee.participant.displayName);
      property.setParameter("role", roleToICal(attendee.role));
      property.setParameter("partstat", statusToICal(attendee.status));
      property.setParameter("cutype", typeToICal(attendee.participantType));
      if (attendee.rsvpRequested !== null) property.setParameter("rsvp", attendee.rsvpRequested ? "TRUE" : "FALSE");
      if (attendee.sentBy) property.setParameter("sent-by", participantUri(attendee.sentBy));
      if (attendee.delegatedTo.length) property.setParameter("delegated-to", attendee.delegatedTo.map(participantUri));
      if (attendee.delegatedFrom.length) property.setParameter("delegated-from", attendee.delegatedFrom.map(participantUri));
      property.setValue(participantUri(attendee.participant));
      master.addProperty(property);
    }
  }
  if (changes.organizer !== undefined) {
    master.removeAllProperties("organizer");
    const property = new ICAL.Property("organizer");
    if (changes.organizer.participant.displayName) property.setParameter("cn", changes.organizer.participant.displayName);
    if (changes.organizer.sentBy) property.setParameter("sent-by", participantUri(changes.organizer.sentBy));
    property.setValue(participantUri(changes.organizer.participant));
    master.addProperty(property);
  }
  if (changes.reminders !== undefined) applyReminderChanges(master, changes.reminders);
}

function touchComponent(component: InstanceType<typeof ICAL.Component>, requestedSequence?: number): void {
  const previousSequence = numericValue(component.getFirstPropertyValue("sequence"));
  const nextSequence = requestedSequence === undefined
    ? previousSequence + 1
    : Math.max(previousSequence, requestedSequence);
  component.updatePropertyWithValue("sequence", nextSequence);
  component.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
}

export function updateICalendarAttendee(
  source: string,
  attendeeEmail: string,
  status: CalendarParticipationStatus,
): string {
  const calendar = ICAL.Component.fromString(source);
  const normalizedEmail = normalizeParticipantEmail(attendeeEmail);
  for (const component of calendar.getAllSubcomponents("vevent")) {
    const attendee = component.getAllProperties("attendee").find((property) => {
      const value = stringValue(property.getFirstValue()) ?? "";
      return normalizeParticipantEmail(value) === normalizedEmail;
    });
    if (!attendee) continue;
    attendee.setParameter("partstat", status.toUpperCase());
    attendee.setParameter("rsvp", "FALSE");
    break;
  }
  return calendar.toString();
}

function participantUri(participant: import("../domain").ParticipantRef): string {
  return participant.normalizedEmail ? `mailto:${participant.value}` : participant.value;
}
function roleToICal(role: import("../domain").AttendanceRole): string {
  return ({ required: "REQ-PARTICIPANT", optional: "OPT-PARTICIPANT", "non-participant": "NON-PARTICIPANT", chair: "CHAIR", unknown: "REQ-PARTICIPANT" })[role];
}
function statusToICal(status: import("../domain").AttendanceStatus): string {
  return status === "unknown" ? "NEEDS-ACTION" : status.toUpperCase();
}
function typeToICal(type: import("../domain").ParticipantType): string {
  return (type === "unknown" ? "INDIVIDUAL" : type).toUpperCase();
}

function decodeEvent(component: InstanceType<typeof ICAL.Component>): ICalendarEventComponent {
  const alarms: ICalendarAlarmComponent[] = [];
  const alarmDiagnostics: import("../domain").CalendarReminderDiagnostic[] = [];
  for (const alarm of component.getAllSubcomponents("valarm")) {
    try {
      alarms.push({ properties: alarm.getAllProperties().map(decodeProperty) });
    } catch {
      alarmDiagnostics.push({ code: "invalid-trigger" });
    }
  }
  return {
    properties: component.getAllProperties().map(decodeProperty),
    alarms,
    alarmDiagnostics,
    serialized: component.toString(),
  };
}

function applyReminderChanges(
  component: InstanceType<typeof ICAL.Component>,
  input: import("../domain").CalendarReminderPolicy,
): void {
  const policy = normalizeCalendarReminderPolicy(input);
  component.removeAllSubcomponents("valarm");
  if (policy.kind === "inherit") {
    throw new Error("Calendar default reminders cannot be represented by VALARM");
  }
  if (policy.kind === "none") return;

  for (const reminder of policy.reminders) {
    if (reminder.method !== "notification") {
      throw new Error("CalDAV reminder method is not supported for writes");
    }
    const alarm = new ICAL.Component("valarm");
    alarm.addPropertyWithValue("action", "DISPLAY");
    alarm.addPropertyWithValue("description", "Calendar reminder");
    const trigger = new ICAL.Property("trigger");
    trigger.resetType("duration");
    trigger.setValue(ICAL.Duration.fromString(formatNegativeDuration(reminder.trigger.duration.seconds)));
    alarm.addProperty(trigger);
    component.addSubcomponent(alarm);
  }
}

function formatNegativeDuration(seconds: number): string {
  if (seconds === 0) return "PT0M";
  let remaining = seconds;
  const days = Math.floor(remaining / 86400);
  remaining %= 86400;
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const datePart = days > 0 ? `${days}D` : "";
  const timePart = hours > 0 || minutes > 0 ? `T${hours > 0 ? `${hours}H` : ""}${minutes > 0 ? `${minutes}M` : ""}` : "";
  return `-P${datePart}${timePart}`;
}

function decodeProperty(property: InstanceType<typeof ICAL.Property>): ICalendarPropertyData {
  const rawParameters = property.jCal[1] as Record<string, string | string[]>;
  const parameters = Object.fromEntries(
    Object.entries(rawParameters).map(([name, value]) => [name.toUpperCase(), cloneParameter(value)]),
  );
  const values = property.getValues().map((value) => serializeDecodedValue(value, property.type));
  return {
    name: property.name.toUpperCase(),
    valueType: property.type.toUpperCase(),
    parameters,
    values,
  };
}

function decodeTimeZone(component: InstanceType<typeof ICAL.Component>): ICalendarTimeZoneDefinition {
  return {
    tzid: stringValue(component.getFirstPropertyValue("tzid")) ?? "",
    location: stringValue(component.getFirstPropertyValue("x-lic-location")),
    serialized: component.toString(),
    observances: [
      ...component.getAllSubcomponents("standard").map((observance) => decodeObservance(observance, "standard")),
      ...component.getAllSubcomponents("daylight").map((observance) => decodeObservance(observance, "daylight")),
    ],
  };
}

function decodeObservance(
  component: InstanceType<typeof ICAL.Component>,
  kind: "standard" | "daylight",
): ICalendarTimeZoneDefinition["observances"][number] {
  return {
    kind,
    dtstart: decodedFirstValue(component, "dtstart"),
    tzOffsetFrom: decodedFirstValue(component, "tzoffsetfrom"),
    tzOffsetTo: decodedFirstValue(component, "tzoffsetto"),
    rule: decodedFirstValue(component, "rrule"),
    dates: component.getAllProperties("rdate").flatMap((property) => decodeProperty(property).values),
  };
}

function decodedFirstValue(component: InstanceType<typeof ICAL.Component>, name: string): string | null {
  const property = component.getFirstProperty(name);
  return property ? decodeProperty(property).values[0] ?? null : null;
}

function serializeDecodedValue(value: unknown, valueType: string): string {
  if (valueType === "date" && isIcalTime(value)) return formatCalendarDate(value);
  if (valueType === "date-time" && isIcalTime(value)) return formatDateTime(value);
  if (valueType === "duration" && value && typeof value === "object" && "toString" in value) {
    return String(value);
  }
  if (valueType === "recur" && value && typeof value === "object" && "toString" in value) {
    return String(value);
  }
  return stringValue(value) ?? "";
}

function setEventTime(component: InstanceType<typeof ICAL.Component>, event: CreateEventInput | UpdateEventInput): void {
  if (event.time) {
    replaceTimeProperty(component, "dtstart", event.time, "start");
    replaceTimeProperty(component, "dtend", event.time, "end");
    return;
  }
  if (!event.startTime || !event.endTime) return;
  if (event.isAllDay) {
    replaceDateProperty(component, "dtstart", event.startTime);
    replaceDateProperty(component, "dtend", event.endTime);
  } else {
    replaceUtcProperty(component, "dtstart", event.startTime);
    replaceUtcProperty(component, "dtend", event.endTime);
  }
}

function updateEventTime(component: InstanceType<typeof ICAL.Component>, changes: UpdateEventInput): void {
  component.removeAllProperties("duration");
  if (changes.time) {
    replaceTimeProperty(component, "dtstart", changes.time, "start");
    replaceTimeProperty(component, "dtend", changes.time, "end");
    return;
  }
  const allDay = changes.isAllDay ?? component.getFirstProperty("dtstart")?.type === "date";
  if (changes.startTime !== undefined) {
    replaceLegacyInstant(component, "dtstart", changes.startTime, allDay);
  }
  if (changes.endTime !== undefined) {
    replaceLegacyInstant(component, "dtend", changes.endTime, allDay);
  }
}

function replaceLegacyInstant(
  component: InstanceType<typeof ICAL.Component>,
  name: "dtstart" | "dtend",
  value: string,
  allDay: boolean,
): void {
  if (allDay) {
    replaceDateProperty(component, name, value);
    return;
  }
  const tzid = component.getFirstProperty(name)?.getFirstParameter("tzid");
  if (tzid) {
    const instant = Math.floor(new Date(value).getTime() / 1000);
    replaceWallProperty(component, name, instantSecondsToWallDateTime(instant, tzid), tzid);
  } else {
    replaceUtcProperty(component, name, value);
  }
}

function replaceTimeProperty(
  component: InstanceType<typeof ICAL.Component>,
  name: "dtstart" | "dtend",
  time: CalendarEventTime,
  edge: "start" | "end",
): void {
  if (time.kind === "all-day") {
    replaceDateProperty(component, name, edge === "start" ? time.startDate : time.endDateExclusive);
  } else if (time.kind === "floating") {
    replaceWallProperty(component, name, edge === "start" ? time.start : time.end);
  } else {
    const point = edge === "start" ? time.start : time.end;
    if (point.tzid === "UTC") replaceUtcWallProperty(component, name, point.wall);
    else replaceWallProperty(component, name, point.wall, point.tzid);
  }
}

function replaceDateProperty(component: InstanceType<typeof ICAL.Component>, name: string, value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) throw new Error(`Invalid all-day date: ${value}`);
  const property = new ICAL.Property(name);
  property.resetType("date");
  property.setValue(ICAL.Time.fromData({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), isDate: true }));
  replaceProperty(component, name, property);
}

function replaceUtcProperty(component: InstanceType<typeof ICAL.Component>, name: string, value: string): void {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid event instant: ${value}`);
  const property = new ICAL.Property(name);
  property.setValue(ICAL.Time.fromJSDate(date, true));
  replaceProperty(component, name, property);
}

function replaceUtcWallProperty(component: InstanceType<typeof ICAL.Component>, name: string, wall: WallDateTime): void {
  const property = new ICAL.Property(name);
  property.setValue(ICAL.Time.fromData(wall, ICAL.Timezone.utcTimezone));
  replaceProperty(component, name, property);
}

function replaceWallProperty(
  component: InstanceType<typeof ICAL.Component>,
  name: string,
  wall: WallDateTime,
  tzid?: string,
): void {
  const property = new ICAL.Property(name);
  if (tzid) property.setParameter("tzid", tzid);
  property.setValue(ICAL.Time.fromData(wall));
  replaceProperty(component, name, property);
}

function replaceProperty(
  component: InstanceType<typeof ICAL.Component>,
  name: string,
  property: InstanceType<typeof ICAL.Property>,
): void {
  component.removeAllProperties(name);
  component.addProperty(property);
}

function identityProperty(name: "recurrence-id" | "exdate", identity: OccurrenceIdentity): InstanceType<typeof ICAL.Property> {
  const property = new ICAL.Property(name);
  if (identity.kind === "all-day") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(identity.date);
    if (!match) throw new Error("Invalid all-day occurrence identity");
    property.resetType("date");
    property.setValue(ICAL.Time.fromData({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), isDate: true }));
  } else if (identity.kind === "floating") {
    property.setValue(ICAL.Time.fromData(identity.wall));
  } else if (identity.tzid === "UTC") {
    property.setValue(ICAL.Time.fromData(identity.wall, ICAL.Timezone.utcTimezone));
  } else {
    property.setParameter("tzid", identity.tzid);
    property.setValue(ICAL.Time.fromData(identity.wall));
  }
  return property;
}

function recurrencePropertyMatches(
  property: InstanceType<typeof ICAL.Property> | null,
  identity: OccurrenceIdentity,
): boolean {
  return property ? property.getValues().some((value) => recurrenceValueMatches(property, value, identity)) : false;
}

function recurrenceValueMatches(
  property: InstanceType<typeof ICAL.Property>,
  value: unknown,
  identity: OccurrenceIdentity,
): boolean {
  if (!(value instanceof ICAL.Time)) return false;
  const expected = identityFingerprint(identity);
  if (value.isDate) return expected === `D|${formatCalendarDate(value)}`;
  const wall = formatDateTime(value).replace(/Z$/, "");
  const isUtc = value.zone === ICAL.Timezone.utcTimezone || value.zone?.tzid === "UTC";
  if (isUtc) return expected === `Z|UTC|${wall}`;
  const tzid = stringValue(property.getFirstParameter("tzid"));
  return expected === (tzid ? `Z|${tzid}|${wall}` : `F|${wall}`);
}

function identityFingerprint(identity: OccurrenceIdentity): string {
  if (identity.kind === "all-day") return `D|${identity.date.replaceAll("-", "")}`;
  const wall = `${pad(identity.wall.year, 4)}${pad(identity.wall.month)}${pad(identity.wall.day)}T${pad(identity.wall.hour)}${pad(identity.wall.minute)}${pad(identity.wall.second)}`;
  return identity.kind === "floating" ? `F|${wall}` : `Z|${identity.tzid}|${wall}`;
}

function updateText(component: InstanceType<typeof ICAL.Component>, name: string, value: string | undefined): void {
  if (value !== undefined) component.updatePropertyWithValue(name, value);
}

function formatCalendarDate(time: InstanceType<typeof ICAL.Time>): string {
  return `${pad(time.year, 4)}${pad(time.month)}${pad(time.day)}`;
}

function formatDateTime(time: InstanceType<typeof ICAL.Time>): string {
  return `${pad(time.year, 4)}${pad(time.month)}${pad(time.day)}T${pad(time.hour)}${pad(time.minute)}${pad(time.second)}${time.zone === ICAL.Timezone.utcTimezone || time.zone?.tzid === "UTC" ? "Z" : ""}`;
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0");
}

function cloneParameter(value: string | string[]): string | string[] {
  return Array.isArray(value) ? [...value] : value;
}

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function numericValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isIcalTime(value: unknown): value is InstanceType<typeof ICAL.Time> {
  return value instanceof ICAL.Time;
}

function extractComponentBlocks(source: string, componentName: string): { blocks: string[]; unreadableComponentCount: number } {
  const blocks: string[] = [];
  let current: string[] | null = null;
  let unreadableComponentCount = 0;
  const begin = `BEGIN:${componentName}`;
  const end = `END:${componentName}`;
  for (const line of unfoldForStructure(source)) {
    const marker = line.trim().toUpperCase();
    if (marker === begin) {
      if (current) unreadableComponentCount += 1;
      current = [begin];
    } else if (marker === end) {
      if (!current) {
        unreadableComponentCount += 1;
      } else {
        current.push(end);
        blocks.push(current.join("\r\n"));
        current = null;
      }
    } else if (current) {
      current.push(line);
    }
  }
  if (current) unreadableComponentCount += 1;
  return { blocks, unreadableComponentCount };
}

function unfoldForStructure(source: string): string[] {
  return source.replace(/\r?\n[ \t]/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function wrapComponents(blocks: string[]): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${blocks.join("\r\n")}\r\nEND:VCALENDAR`;
}

function isCalendarEnvelope(source: string): boolean {
  const markers = unfoldForStructure(source).map((line) => line.trim().toUpperCase());
  return markers.includes("BEGIN:VCALENDAR") && markers.includes("END:VCALENDAR");
}
