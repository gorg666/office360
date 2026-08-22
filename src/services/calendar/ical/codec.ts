import ICAL from "ical.js";
import type { CalendarParticipationStatus, CreateEventInput, UpdateEventInput } from "../types";
import {
  instantSecondsToWallDateTime,
  type CalendarEventTime,
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
  serialized: string;
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
    for (const attendee of event.attendees) {
      const property = new ICAL.Property("attendee");
      property.setParameter("rsvp", "TRUE");
      property.setValue(`mailto:${attendee.email}`);
      component.addProperty(property);
    }
  }
  return calendar.toString();
}

export function updateICalendarEvent(source: string, changes: UpdateEventInput): string {
  const calendar = ICAL.Component.fromString(source);
  const master = calendar.getAllSubcomponents("vevent")
    .find((component) => !component.hasProperty("recurrence-id"));
  if (!master) return source;

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
  const previousSequence = numericValue(master.getFirstPropertyValue("sequence"));
  const nextSequence = changes.sequence === undefined
    ? previousSequence + 1
    : Math.max(previousSequence, changes.sequence);
  master.updatePropertyWithValue("sequence", nextSequence);
  master.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
  return calendar.toString();
}

export function updateICalendarAttendee(
  source: string,
  attendeeEmail: string,
  status: CalendarParticipationStatus,
): string {
  const calendar = ICAL.Component.fromString(source);
  const normalizedEmail = attendeeEmail.trim().toLowerCase();
  for (const component of calendar.getAllSubcomponents("vevent")) {
    const attendee = component.getAllProperties("attendee").find((property) => {
      const value = stringValue(property.getFirstValue()) ?? "";
      return value.replace(/^mailto:/i, "").trim().toLowerCase() === normalizedEmail;
    });
    if (!attendee) continue;
    attendee.setParameter("partstat", status.toUpperCase());
    attendee.setParameter("rsvp", "FALSE");
    break;
  }
  return calendar.toString();
}

function decodeEvent(component: InstanceType<typeof ICAL.Component>): ICalendarEventComponent {
  return {
    properties: component.getAllProperties().map(decodeProperty),
    serialized: component.toString(),
  };
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
