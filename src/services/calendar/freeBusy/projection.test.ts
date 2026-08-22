import { describe, expect, it } from "vitest";
import { parseVEventsInRange } from "../icalHelper";
import { calendarOrganizerFromInput, dedupeCalendarAttendees } from "../domain";
import type { CalendarEventData } from "../types";
import { mergeBusyIntervals } from "./intervals";
import {
  projectEventsToBusyIntervals,
  projectSourceEvent,
  type AvailabilitySourceEvent,
} from "./projection";

const SELF = { accountId: "account-1", email: "self@example.test" };
const UTC = { timeZone: "UTC" };
const iso = (instant: number) => new Date(instant * 1000).toISOString();

function sourceEvent(overrides: Partial<AvailabilitySourceEvent> = {}): AvailabilitySourceEvent {
  const start = Date.UTC(2026, 2, 15, 10) / 1000;
  const end = Date.UTC(2026, 2, 15, 11) / 1000;
  return {
    time: {
      kind: "timed-zoned",
      start: { wall: { year: 2026, month: 3, day: 15, hour: 10, minute: 0, second: 0 }, tzid: "UTC", instant: start },
      end: { wall: { year: 2026, month: 3, day: 15, hour: 11, minute: 0, second: 0 }, tzid: "UTC", instant: end },
    },
    startInstant: start,
    endInstant: end,
    eventStatus: "confirmed",
    transparency: "opaque",
    selfAttendance: null,
    provisional: false,
    timeZoneUnresolved: false,
    ...overrides,
  };
}

describe("event -> busy projection", () => {
  it("treats an opaque confirmed event as hard busy", () => {
    expect(projectSourceEvent(sourceEvent(), UTC).intervals).toEqual([
      { start: Date.UTC(2026, 2, 15, 10) / 1000, end: Date.UTC(2026, 2, 15, 11) / 1000, busyType: "busy" },
    ]);
  });

  it("treats a missing TRANSP as opaque, per RFC 5545", () => {
    expect(projectSourceEvent(sourceEvent({ transparency: null }), UTC).intervals).toHaveLength(1);
  });

  it("produces no busy time for a transparent event", () => {
    expect(projectSourceEvent(sourceEvent({ transparency: "transparent" }), UTC).intervals).toEqual([]);
  });

  it("produces no busy time for a cancelled event", () => {
    expect(projectSourceEvent(sourceEvent({ eventStatus: "cancelled" }), UTC).intervals).toEqual([]);
    expect(projectSourceEvent(sourceEvent({ eventStatus: "CANCELLED" }), UTC).intervals).toEqual([]);
  });

  it("distinguishes a tentative event from hard busy", () => {
    expect(projectSourceEvent(sourceEvent({ eventStatus: "tentative" }), UTC).intervals[0]?.busyType)
      .toBe("tentative");
  });

  it("frees the decliner's own time but keeps accepted and tentative attendance", () => {
    expect(projectSourceEvent(sourceEvent({ selfAttendance: "declined" }), UTC).intervals).toEqual([]);
    expect(projectSourceEvent(sourceEvent({ selfAttendance: "accepted" }), UTC).intervals[0]?.busyType)
      .toBe("busy");
    expect(projectSourceEvent(sourceEvent({ selfAttendance: "tentative" }), UTC).intervals[0]?.busyType)
      .toBe("tentative");
    expect(projectSourceEvent(sourceEvent({ selfAttendance: "needs-action" }), UTC).intervals[0]?.busyType)
      .toBe("busy");
  });

  it("marks an unconfirmed local projection as tentative rather than hard busy", () => {
    const projected = projectSourceEvent(sourceEvent({ provisional: true }), UTC);
    expect(projected.intervals[0]?.busyType).toBe("tentative");
    expect(projected.diagnostics.map((value) => value.code)).toContain("pending-local-projection");
  });

  it("gives required and optional attendees identical busy semantics", () => {
    // Role lives in the scheduling layer; availability depends on identity, not on role.
    const attendees = dedupeCalendarAttendees([
      { email: "self@example.test", responseStatus: "accepted" },
      { email: "other@example.test", optional: true, responseStatus: "accepted" },
    ]);
    const event = {
      ...baseEventData(),
      attendees,
      organizer: calendarOrganizerFromInput({ email: "owner@example.test" }),
    };
    const asRequired = projectEventsToBusyIntervals([event], SELF, UTC).intervals;
    const asOptional = projectEventsToBusyIntervals([event], { email: "other@example.test" }, UTC).intervals;
    expect(asOptional).toEqual(asRequired);
  });
});

describe("all-day busy projection uses the effective zone, not host midnight", () => {
  const allDay = sourceEvent({
    time: { kind: "all-day", startDate: "2026-03-15", endDateExclusive: "2026-03-16" },
  });

  it.each([
    ["UTC", "2026-03-15T00:00:00.000Z", "2026-03-16T00:00:00.000Z"],
    ["Europe/Moscow", "2026-03-14T21:00:00.000Z", "2026-03-15T21:00:00.000Z"],
    ["America/New_York", "2026-03-15T04:00:00.000Z", "2026-03-16T04:00:00.000Z"],
    ["Australia/Lord_Howe", "2026-03-14T13:00:00.000Z", "2026-03-15T13:00:00.000Z"],
  ])("blocks the whole calendar date in %s", (timeZone, start, end) => {
    const [interval] = projectSourceEvent(allDay, { timeZone }).intervals;
    expect(iso(interval!.start)).toBe(start);
    expect(iso(interval!.end)).toBe(end);
  });
});

describe("floating busy projection is flagged, never silently host-local", () => {
  const floating = sourceEvent({
    time: {
      kind: "floating",
      start: { year: 2026, month: 3, day: 15, hour: 10, minute: 0, second: 0 },
      end: { year: 2026, month: 3, day: 15, hour: 11, minute: 0, second: 0 },
    },
  });

  it("resolves against the requested zone and reports the assumption", () => {
    const moscow = projectSourceEvent(floating, { timeZone: "Europe/Moscow" });
    expect(iso(moscow.intervals[0]!.start)).toBe("2026-03-15T07:00:00.000Z");
    expect(moscow.diagnostics.map((value) => value.code)).toContain("floating-timezone-assumed");

    const newYork = projectSourceEvent(floating, { timeZone: "America/New_York" });
    expect(iso(newYork.intervals[0]!.start)).toBe("2026-03-15T14:00:00.000Z");
  });
});

describe("recurring busy projection matches calendar expansion semantics", () => {
  const range = { start: Date.UTC(2026, 2, 1) / 1000, end: Date.UTC(2026, 2, 30) / 1000 };
  const expand = (lines: string[]): CalendarEventData[] => parseVEventsInRange(
    ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n"),
    "/series.ics",
    new Date(range.start * 1000),
    new Date(range.end * 1000),
    { floatingTimeZone: "UTC" },
  );

  it("keeps a weekly New York series on its wall clock across the DST change", () => {
    const events = expand([
      "BEGIN:VEVENT", "UID:weekly",
      "DTSTART;TZID=America/New_York:20260301T100000",
      "DTEND;TZID=America/New_York:20260301T110000",
      "RRULE:FREQ=WEEKLY;COUNT=4", "END:VEVENT",
    ]);
    const busy = mergeBusyIntervals(projectEventsToBusyIntervals(events, SELF, UTC).intervals, range);
    expect(busy.map((interval) => iso(interval.start))).toEqual([
      "2026-03-01T15:00:00.000Z",
      "2026-03-08T14:00:00.000Z",
      "2026-03-15T14:00:00.000Z",
      "2026-03-22T14:00:00.000Z",
    ]);
  });

  it("honours EXDATE, RECURRENCE-ID overrides and RDATE", () => {
    const events = expand([
      "BEGIN:VEVENT", "UID:series",
      "DTSTART;TZID=America/New_York:20260301T100000",
      "DTEND;TZID=America/New_York:20260301T110000",
      "RRULE:FREQ=WEEKLY;COUNT=3",
      "EXDATE;TZID=America/New_York:20260315T100000",
      "RDATE;TZID=America/New_York:20260329T100000", "END:VEVENT",
      "BEGIN:VEVENT", "UID:series",
      "RECURRENCE-ID;TZID=America/New_York:20260308T100000",
      "DTSTART;TZID=America/New_York:20260308T120000",
      "DTEND;TZID=America/New_York:20260308T130000", "END:VEVENT",
    ]);
    const busy = mergeBusyIntervals(projectEventsToBusyIntervals(events, SELF, UTC).intervals, range);
    expect(busy.map((interval) => iso(interval.start))).toEqual([
      "2026-03-01T15:00:00.000Z",
      "2026-03-08T16:00:00.000Z", // moved by the override
      "2026-03-29T14:00:00.000Z", // added by RDATE; 15 March removed by EXDATE
    ]);
  });

  it("clips a long overlapping occurrence to the requested window", () => {
    const events = expand([
      "BEGIN:VEVENT", "UID:offsite",
      "DTSTART:20260302T100000Z", "DTEND:20260307T100000Z",
      "RRULE:FREQ=WEEKLY;COUNT=4", "END:VEVENT",
    ]);
    const window = { start: Date.UTC(2026, 2, 13) / 1000, end: Date.UTC(2026, 2, 15) / 1000 };
    const busy = mergeBusyIntervals(projectEventsToBusyIntervals(events, SELF, UTC).intervals, window);
    expect(busy).toEqual([{ start: window.start, end: Date.UTC(2026, 2, 14, 10) / 1000, busyType: "busy" }]);
  });
});

function baseEventData(): CalendarEventData {
  const start = Date.UTC(2026, 2, 15, 10) / 1000;
  const end = Date.UTC(2026, 2, 15, 11) / 1000;
  return {
    remoteEventId: "remote-1", uid: "uid-1", etag: null,
    summary: "Planning", description: null, location: null,
    startTime: start, endTime: end, isAllDay: false, status: "confirmed",
    organizerEmail: null, attendeesJson: null, organizer: null, attendees: [],
    htmlLink: null, icalData: null,
    time: {
      kind: "timed-zoned",
      start: { wall: { year: 2026, month: 3, day: 15, hour: 10, minute: 0, second: 0 }, tzid: "UTC", instant: start },
      end: { wall: { year: 2026, month: 3, day: 15, hour: 11, minute: 0, second: 0 }, tzid: "UTC", instant: end },
    },
    seriesUid: "uid-1", occurrenceKey: null, isRecurrenceMaster: false,
    transparency: "opaque", sequence: 0, participants: [],
  };
}
