import ICAL from "ical.js";
import type { BusyInterval } from "../freeBusy/types";

function utcStamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");
}

export function encodeVFreeBusyRequest(input: {
  organizer: string;
  attendees: readonly string[];
  start: number;
  end: number;
  uid: string;
  now: number;
}): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Office360//Calendar FreeBusy//EN",
    "METHOD:REQUEST",
    "BEGIN:VFREEBUSY",
    `UID:${escapeText(input.uid)}`,
    `DTSTAMP:${utcStamp(input.now)}`,
    `DTSTART:${utcStamp(input.start)}`,
    `DTEND:${utcStamp(input.end)}`,
    `ORGANIZER:${input.organizer}`,
    ...input.attendees.map((attendee) => `ATTENDEE:${attendee}`),
    "END:VFREEBUSY",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** Decode only opaque busy geometry; no event component or metadata can cross this codec. */
export function decodeVFreeBusy(source: string): BusyInterval[] {
  const root = ICAL.Component.fromString(source);
  const component = root.name === "vfreebusy" ? root : root.getFirstSubcomponent("vfreebusy");
  if (!component) return [];
  const intervals: BusyInterval[] = [];
  for (const property of component.getAllProperties("freebusy")) {
    const type = String(property.getParameter("fbtype") ?? "BUSY").toUpperCase();
    if (type === "FREE") continue;
    const busyType = type === "BUSY-TENTATIVE" ? "tentative" as const : "busy" as const;
    for (const period of property.getValues() as Array<{ start?: { toJSDate(): Date }; end?: { toJSDate(): Date }; duration?: { toSeconds(): number } }>) {
      const start = period.start?.toJSDate().getTime();
      const end = period.end?.toJSDate().getTime()
        ?? (start !== undefined && period.duration ? start + period.duration.toSeconds() * 1000 : undefined);
      if (start !== undefined && end !== undefined && Number.isFinite(start) && Number.isFinite(end)) {
        intervals.push({ start: start / 1000, end: end / 1000, busyType });
      }
    }
  }
  return intervals;
}
