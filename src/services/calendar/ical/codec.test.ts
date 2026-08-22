import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeICalendar } from "./codec";
import {
  generateVEvent,
  parseICalendarInvite,
  parseVEvent,
  parseVEventsInRangeDetailed,
  updateAttendeeParticipation,
  updateVEventFields,
  updateVEventOccurrence,
  excludeVEventOccurrence,
} from "../icalHelper";
import type { CalendarEventTime } from "../domain";

function fixture(name: string): string {
  return readFileSync(resolve(process.cwd(), "src/services/calendar/ical/__fixtures__", name), "utf8");
}

describe("ical.js codec boundary", () => {
  it.each([
    ["Europe/Moscow", "moscow-1"],
    ["America/New_York", "new-york-1"],
    ["Australia/Lord_Howe", "lord-howe-1"],
  ])("round-trips %s wall time and TZID", (tzid, uid) => {
    const decoded = decodeICalendar(fixture("zoned-matrix.ics"));
    const component = decoded.events.find((event) => event.properties.some((property) => property.name === "UID" && property.values[0] === uid));
    expect(component).toBeDefined();
    const parsed = parseVEvent(component!.serialized);
    expect(parsed.time).toMatchObject({ kind: "timed-zoned", start: { tzid, wall: { hour: 10 } } });
    const serialized = generateVEvent({
      summary: parsed.summary ?? "",
      startTime: new Date(parsed.startTime * 1000).toISOString(),
      endTime: new Date(parsed.endTime * 1000).toISOString(),
      time: parsed.time,
    }, parsed.uid ?? undefined);
    expect(parseVEvent(serialized).time).toEqual(parsed.time);
  });

  it("decodes UTC, floating, all-day and RFC text escaping as plain data", () => {
    const decoded = decodeICalendar(fixture("rfc-basics.ics"));
    expect(decoded.events).toHaveLength(3);
    expect(decoded.unreadableComponentCount).toBe(0);

    const utc = parseVEvent(decoded.events[0]!.serialized);
    expect(utc.time.kind).toBe("timed-zoned");
    expect(utc.time.kind === "timed-zoned" && utc.time.start.tzid).toBe("UTC");
    expect(utc.description).toBe("Comma, semicolon; slash\\ and newline\nnext");

    const allDay = parseVEvent(decoded.events[1]!.serialized);
    expect(allDay.time).toEqual({ kind: "all-day", startDate: "2026-03-16", endDateExclusive: "2026-03-18" });

    const floating = parseVEvent(decoded.events[2]!.serialized);
    expect(floating.time.kind).toBe("floating");
    expect(floating.startTime).toBe(Date.UTC(2026, 2, 19, 9, 30) / 1000);
  });

  it("resolves IANA, Windows aliases and VTIMEZONE locations without host-local fallback", () => {
    const decoded = decodeICalendar(fixture("vtimezone-windows.ics"));
    expect(decoded.timeZones).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tzid: "Vendor Moscow Time",
        location: "Europe/Moscow",
        observances: [expect.objectContaining({
          kind: "standard",
          dtstart: "19700101T000000",
          tzOffsetFrom: "+03:00",
          tzOffsetTo: "+03:00",
        })],
      }),
    ]));

    const range = parseVEventsInRangeDetailed(
      fixture("vtimezone-windows.ics"),
      "/zones.ics",
      new Date("2026-03-01T00:00:00Z"),
      new Date("2026-04-01T00:00:00Z"),
    );
    expect(range.events.map((event) => event.time.kind === "timed-zoned" && event.time.start.tzid))
      .toEqual(["Europe/Moscow", "Europe/Moscow"]);
    expect(range.events.every((event) => event.timeZoneDiagnostic === undefined)).toBe(true);

    const unknown = parseVEvent([
      "BEGIN:VEVENT",
      "UID:unknown-zone",
      "DTSTART;TZID=Vendor/Unknown:20260315T100000",
      "DTEND;TZID=Vendor/Unknown:20260315T110000",
      "END:VEVENT",
    ].join("\r\n"));
    expect(unknown.time.kind).toBe("floating");
    expect(unknown.startTime).toBe(Date.UTC(2026, 2, 15, 10) / 1000);
    expect(unknown.timeZoneDiagnostic).toEqual({ status: "unsupported-timezone", originalTzid: "Vendor/Unknown" });
  });

  it("preserves recurrence metadata, unknown properties and VTIMEZONE on update", () => {
    const source = fixture("recurrence.ics");
    const updated = updateVEventFields(source, { summary: "Updated weekly" });
    expect(updated).toContain("RRULE:FREQ=WEEKLY;COUNT=4");
    expect(updated).toContain("EXDATE;TZID=America/New_York:20260308T100000");
    expect(updated).toContain("RDATE;TZID=America/New_York:20260331T100000");
    expect(updated).toContain("DURATION:PT1H30M");
    expect(updated).toContain("RECURRENCE-ID;TZID=America/New_York:20260315T100000");
    expect(updated).toContain("X-OFFICE360-PRESERVE:yes");
    expect(updated).toContain("SEQUENCE:4");

    const zoned = fixture("vtimezone-windows.ics");
    const updatedZoned = updateVEventFields(zoned, { summary: "Updated zone" });
    expect(updatedZoned).toContain("BEGIN:VTIMEZONE");
    expect(updatedZoned).toContain("X-LIC-LOCATION:Europe/Moscow");
  });

  it("serializes semantic times, escaping, folding and sequence through ical.js", () => {
    const time: CalendarEventTime = {
      kind: "timed-zoned",
      start: { wall: { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 }, tzid: "America/New_York", instant: 1793511000 },
      end: { wall: { year: 2026, month: 11, day: 1, hour: 2, minute: 30, second: 0 }, tzid: "America/New_York", instant: 1793518200 },
    };
    const source = generateVEvent({
      summary: `Long, escaped; summary ${"x".repeat(90)}`,
      startTime: "2026-11-01T05:30:00Z",
      endTime: "2026-11-01T07:30:00Z",
      time,
      status: "confirmed",
      transparency: "transparent",
      sequence: 9,
    }, "serialize-1");
    expect(source).toContain("DTSTART;TZID=America/New_York:20261101T013000");
    expect(source).toContain("SEQUENCE:9");
    expect(source).toContain("STATUS:CONFIRMED");
    expect(source).toContain("TRANSP:TRANSPARENT");
    expect(source).toMatch(/SUMMARY:Long\\, escaped\\; summary x+\r\n /);
    expect(parseVEvent(source).summary).toBe(`Long, escaped; summary ${"x".repeat(90)}`);
  });

  it("keeps readable siblings when an individual component is malformed", () => {
    const parsed = parseVEventsInRangeDetailed(
      fixture("malformed-neighbor.ics"),
      "/mixed.ics",
      new Date("2026-03-15T00:00:00Z"),
      new Date("2026-03-16T00:00:00Z"),
    );
    expect(parsed.events.map((event) => event.uid)).toEqual(["good-before", "good-after"]);
    expect(parsed.diagnostics.unreadableComponentCount).toBe(1);
  });

  it("preserves extended attendee parameters and updates only participation", () => {
    const source = fixture("attendee-params.ics");
    const invite = parseICalendarInvite(source);
    expect(invite.method).toBe("REQUEST");
    expect(invite.attendees[0]).toMatchObject({
      email: "jane@example.com",
      displayName: "Doe, Jane",
      role: "REQ-PARTICIPANT",
      calendarUserType: "INDIVIDUAL",
      responseStatus: "tentative",
      rsvp: true,
      sentBy: "mailto:assistant@example.com",
      delegatedTo: ["mailto:delegate@example.com"],
    });
    const replied = updateAttendeeParticipation(source, "jane@example.com", "accepted");
    const repliedInvite = parseICalendarInvite(replied);
    expect(repliedInvite.attendees[0]).toMatchObject({
      responseStatus: "accepted",
      role: "REQ-PARTICIPANT",
      delegatedTo: ["mailto:delegate@example.com"],
    });
  });

  it("handles LF folding, tab folding and quoted parameters with punctuation", () => {
    const source = fixture("folded-quoted.ics");
    const event = parseVEvent(source);
    expect(event.description).toContain("andcontinues here");
    expect(event.location).toBe("Room 42");
    const attendee = decodeICalendar(source).events[0]!.properties.find((property) => property.name === "ATTENDEE");
    expect(attendee?.parameters).toMatchObject({
      CN: "Doe, Jane; Platform",
      ALTREP: "CID:part1.0001@example.org",
      ROLE: "REQ-PARTICIPANT",
    });
  });

  it("keeps occurrence keys stable across codec serialization", () => {
    const original = parseVEventsInRangeDetailed(
      fixture("recurrence.ics"),
      "/series.ics",
      new Date("2026-03-01T00:00:00Z"),
      new Date("2026-04-02T00:00:00Z"),
    ).events;
    const serialized = updateVEventFields(fixture("recurrence.ics"), { location: "Codec room" });
    const roundTripped = parseVEventsInRangeDetailed(
      serialized,
      "/series.ics",
      new Date("2026-03-01T00:00:00Z"),
      new Date("2026-04-02T00:00:00Z"),
    ).events;
    expect(roundTripped.map((event) => event.occurrenceKey)).toEqual(original.map((event) => event.occurrenceKey));
  });

  it("updates one zoned occurrence as an override without changing the master or sibling exceptions", () => {
    const source = fixture("recurrence.ics");
    const identity = { kind: "timed-zoned" as const, tzid: "America/New_York", wall: { year: 2026, month: 3, day: 22, hour: 10, minute: 0, second: 0 } };
    const updated = updateVEventOccurrence(source, { summary: "Only March 22" }, "series-1", identity);
    const decoded = decodeICalendar(updated);
    const master = decoded.events.find((event) => !event.properties.some((property) => property.name === "RECURRENCE-ID"));
    const occurrence = decoded.events.find((event) => event.properties.some((property) => property.name === "RECURRENCE-ID" && property.values[0] === "20260322T100000"));
    expect(master?.properties.find((property) => property.name === "SUMMARY")?.values[0]).not.toBe("Only March 22");
    expect(occurrence?.properties.find((property) => property.name === "SUMMARY")?.values[0]).toBe("Only March 22");
    expect(updated).toContain("RRULE:FREQ=WEEKLY;COUNT=4");
    expect(updated).toContain("RDATE;TZID=America/New_York:20260331T100000");
    expect(updated).toContain("EXDATE;TZID=America/New_York:20260308T100000");
    expect(updated).toContain("RECURRENCE-ID;TZID=America/New_York:20260315T100000");
  });

  it("moves one occurrence across timezone, duration and attendee changes while keeping original identity", () => {
    const identity = { kind: "timed-zoned" as const, tzid: "America/New_York", wall: { year: 2026, month: 3, day: 22, hour: 10, minute: 0, second: 0 } };
    const updated = updateVEventOccurrence(fixture("recurrence.ics"), {
      time: {
        kind: "timed-zoned",
        start: { wall: { year: 2026, month: 3, day: 26, hour: 14, minute: 0, second: 0 }, tzid: "Australia/Lord_Howe", instant: 1_774_493_400 },
        end: { wall: { year: 2026, month: 3, day: 26, hour: 15, minute: 30, second: 0 }, tzid: "Australia/Lord_Howe", instant: 1_774_498_800 },
      },
      attendees: [{ email: "new.attendee@example.com" }],
    }, "series-1", identity);

    expect(updated).toContain("RECURRENCE-ID;TZID=America/New_York:20260322T100000");
    expect(updated).toContain("DTSTART;TZID=Australia/Lord_Howe:20260326T140000");
    expect(updated).toContain("DTEND;TZID=Australia/Lord_Howe:20260326T153000");
    expect(updated).toContain("ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CUTYPE=INDIVID");
    expect(decodeICalendar(updated).events.flatMap((event) => event.properties)
      .find((property) => property.name === "ATTENDEE")?.values).toContain("mailto:new.attendee@example.com");
    expect(updated.match(/RRULE:/g)).toHaveLength(1);
  });

  it("deletes one moved occurrence by original RECURRENCE-ID using EXDATE", () => {
    const source = fixture("recurrence.ics");
    const identity = { kind: "timed-zoned" as const, tzid: "America/New_York", wall: { year: 2026, month: 3, day: 15, hour: 10, minute: 0, second: 0 } };
    const updated = excludeVEventOccurrence(source, "series-1", identity);
    expect(updated).not.toContain("RECURRENCE-ID;TZID=America/New_York:20260315T100000");
    expect(updated).toContain("EXDATE;TZID=America/New_York:20260315T100000");
    expect(updated).toContain("RRULE:FREQ=WEEKLY;COUNT=4");
    expect(updated).toContain("RDATE;TZID=America/New_York:20260331T100000");
  });

  it.each([
    ["first", { year: 2026, month: 3, day: 1, hour: 10, minute: 0, second: 0 }, "20260301T100000"],
    ["middle", { year: 2026, month: 3, day: 22, hour: 10, minute: 0, second: 0 }, "20260322T100000"],
    ["after DST", { year: 2026, month: 3, day: 29, hour: 10, minute: 0, second: 0 }, "20260329T100000"],
  ])("excludes the %s occurrence without deleting the series", (_label, wall, expected) => {
    const updated = excludeVEventOccurrence(fixture("recurrence.ics"), "series-1", {
      kind: "timed-zoned", tzid: "America/New_York", wall,
    });
    expect(updated).toContain(`EXDATE;TZID=America/New_York:${expected}`);
    expect(updated).toContain("RRULE:FREQ=WEEKLY;COUNT=4");
  });

  it("updates series time, duration and RRULE while preserving UID, RDATE, EXDATE and overrides", () => {
    const updated = updateVEventFields(fixture("recurrence.ics"), {
      recurrenceRule: "FREQ=WEEKLY;COUNT=8",
      time: {
        kind: "timed-zoned",
        start: { wall: { year: 2026, month: 3, day: 1, hour: 9, minute: 0, second: 0 }, tzid: "America/New_York", instant: 1_772_372_400 },
        end: { wall: { year: 2026, month: 3, day: 1, hour: 10, minute: 45, second: 0 }, tzid: "America/New_York", instant: 1_772_378_700 },
      },
    });
    expect(updated).toContain("UID:series-1");
    expect(updated).toContain("RRULE:FREQ=WEEKLY;COUNT=8");
    expect(updated).toContain("DTSTART;TZID=America/New_York:20260301T090000");
    expect(updated).toContain("DTEND;TZID=America/New_York:20260301T104500");
    expect(updated).toContain("EXDATE;TZID=America/New_York:20260308T100000");
    expect(updated).toContain("RDATE;TZID=America/New_York:20260331T100000");
    expect(updated).toContain("RECURRENCE-ID;TZID=America/New_York:20260315T100000");
  });

  it.each([
    [{ kind: "all-day" as const, date: "2026-03-22" }, "EXDATE;VALUE=DATE:20260322"],
    [{ kind: "floating" as const, wall: { year: 2026, month: 3, day: 22, hour: 10, minute: 0, second: 0 } }, "EXDATE:20260322T100000"],
  ])("preserves %s occurrence value type on exclusion", (identity, expected) => {
    const source = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:typed-series\r\nDTSTART${identity.kind === "all-day" ? ";VALUE=DATE:20260301" : ":20260301T100000"}\r\nDTEND${identity.kind === "all-day" ? ";VALUE=DATE:20260302" : ":20260301T110000"}\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    expect(excludeVEventOccurrence(source, "typed-series", identity)).toContain(expected);
  });

  it("parses REQUEST, REPLY and CANCEL iTIP metadata", () => {
    expect(parseICalendarInvite(fixture("attendee-params.ics")).method).toBe("REQUEST");
    const reply = parseICalendarInvite(fixture("invitation-reply.ics"));
    expect(reply).toMatchObject({ method: "REPLY", sequence: 7, recurrenceId: "20260315T100000", timezoneId: "Europe/Moscow", timezoneWarning: false });
    const cancel = parseICalendarInvite(fixture("invitation-cancel.ics"));
    expect(cancel.method).toBe("CANCEL");
    expect(cancel.isCancelled).toBe(true);
  });
});
