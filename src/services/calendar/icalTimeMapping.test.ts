import { generateVEvent, parseVEvent, parseVEventsInRange, parseVEventsInRangeDetailed, updateVEventFields } from "./icalHelper";
import { parseICalContentLine } from "./icalTimeMapping";

const HOST_TIME_ZONES = ["UTC", "Europe/Moscow", "America/New_York", "Australia/Lord_Howe"];

describe.each(HOST_TIME_ZONES)("Calendar semantic matrix with host zone %s", (floatingTimeZone) => {
  const options = { floatingTimeZone };

  it("keeps UTC and TZID instants stable", () => {
    const utc = parseVEvent(eventWith("DTSTART:20260315T100000Z", "DTEND:20260315T110000Z"), undefined, options);
    const moscow = parseVEvent(eventWith(
      "DTSTART;TZID=Europe/Moscow:20260315T100000",
      "DTEND;TZID=Europe/Moscow:20260315T110000",
    ), undefined, options);

    expect(utc.startTime).toBe(1773568800);
    expect(moscow.startTime).toBe(1773558000);
    expect(moscow.time).toMatchObject({
      kind: "timed-zoned",
      start: { tzid: "Europe/Moscow", wall: { hour: 10 } },
    });
  });

  it("preserves floating wall time without assigning UTC semantics", () => {
    const event = parseVEvent(eventWith("DTSTART:20260315T100000", "DTEND:20260315T110000"), undefined, options);
    expect(event.time).toEqual({
      kind: "floating",
      start: { year: 2026, month: 3, day: 15, hour: 10, minute: 0, second: 0 },
      end: { year: 2026, month: 3, day: 15, hour: 11, minute: 0, second: 0 },
    });
  });

  it("preserves all-day exclusive date semantics", () => {
    const event = parseVEvent(eventWith(
      "DTSTART;VALUE=DATE:20260315",
      "DTEND;VALUE=DATE:20260316",
    ), undefined, options);
    expect(event.time).toEqual({ kind: "all-day", startDate: "2026-03-15", endDateExclusive: "2026-03-16" });
  });

  it("uses DURATION when DTEND is absent", () => {
    const event = parseVEvent(eventWith("DTSTART:20260315T100000Z", "DURATION:PT45M"), undefined, options);
    expect(event.endTime - event.startTime).toBe(45 * 60);
  });
});

describe("Calendar recurrence semantics", () => {
  it("keeps weekly New York occurrences at 10:00 across DST", () => {
    const ical = calendar([
      vevent([
        "UID:weekly-dst",
        "DTSTART;TZID=America/New_York:20260301T100000",
        "DTEND;TZID=America/New_York:20260301T110000",
        "RRULE:FREQ=WEEKLY;COUNT=4",
      ]),
    ]);
    const events = parseVEventsInRange(ical, "/series.ics", new Date("2026-02-28T00:00:00Z"), new Date("2026-03-23T23:59:59Z"), { floatingTimeZone: "UTC" });

    expect(events.map((event) => event.time.kind === "timed-zoned" ? event.time.start.wall.hour : null))
      .toEqual([10, 10, 10, 10]);
    expect(events.map((event) => new Date(event.startTime * 1000).toISOString()))
      .toEqual([
        "2026-03-01T15:00:00.000Z",
        "2026-03-08T14:00:00.000Z",
        "2026-03-15T14:00:00.000Z",
        "2026-03-22T14:00:00.000Z",
      ]);
  });

  it("matches EXDATE Z and TZID through canonical occurrence identity", () => {
    const ical = calendar([vevent([
      "UID:excluded-series",
      "DTSTART;TZID=America/New_York:20260301T100000",
      "DTEND;TZID=America/New_York:20260301T110000",
      "RRULE:FREQ=WEEKLY;COUNT=4",
      "EXDATE:20260308T140000Z",
      "EXDATE;TZID=America/New_York:20260315T100000",
    ])]);
    const events = parseVEventsInRange(ical, "/excluded.ics", new Date("2026-03-01T00:00:00Z"), new Date("2026-03-23T00:00:00Z"));
    expect(events.map((event) => new Date(event.startTime * 1000).toISOString()))
      .toEqual(["2026-03-01T15:00:00.000Z", "2026-03-22T14:00:00.000Z"]);
  });

  it("applies RECURRENCE-ID overrides and adds RDATE", () => {
    const ical = calendar([
      vevent([
        "UID:override-series",
        "SUMMARY:Master",
        "DTSTART;TZID=America/New_York:20260301T100000",
        "DTEND;TZID=America/New_York:20260301T110000",
        "RRULE:FREQ=WEEKLY;COUNT=2",
        "RDATE;TZID=America/New_York:20260329T100000",
      ]),
      vevent([
        "UID:override-series",
        "RECURRENCE-ID;TZID=America/New_York:20260308T100000",
        "SUMMARY:Moved",
        "DTSTART;TZID=America/New_York:20260308T120000",
        "DTEND;TZID=America/New_York:20260308T130000",
      ]),
    ]);
    const events = parseVEventsInRange(ical, "/override.ics", new Date("2026-03-01T00:00:00Z"), new Date("2026-03-30T00:00:00Z"));
    expect(events.map((event) => event.summary)).toEqual(["Master", "Moved", "Master"]);
    expect(events.every((event) => event.occurrenceKey?.includes("override-series"))).toBe(true);
    expect(new Set(events.map((event) => event.occurrenceKey)).size).toBe(3);
  });

  it.each([1, 3, 5, 10])("returns a %i-day recurring occurrence that starts before and overlaps the range", (days) => {
    const start = new Date("2026-03-01T10:00:00Z");
    const rangeStart = new Date(start.getTime() + days * 86400000 - 3600000);
    const events = parseVEventsInRange(calendar([vevent([
      `UID:long-${days}`,
      "DTSTART:20260301T100000Z",
      `DURATION:P${days}D`,
      "RRULE:FREQ=WEEKLY;COUNT=1",
    ])]), `/long-${days}.ics`, rangeStart, new Date(rangeStart.getTime() + 2 * 3600000));

    expect(events).toHaveLength(1);
    expect(events[0]?.uid).toBe(`long-${days}`);
  });

  it("keeps end-at-range-start exclusive for a long occurrence", () => {
    const events = parseVEventsInRange(calendar([vevent([
      "UID:ends-at-boundary",
      "DTSTART:20260301T100000Z",
      "DURATION:P5D",
      "RRULE:FREQ=WEEKLY;COUNT=1",
    ])]), "/boundary.ics", new Date("2026-03-06T10:00:00Z"), new Date("2026-03-06T11:00:00Z"));

    expect(events).toEqual([]);
  });
});

describe("malformed event isolation", () => {
  const rangeStart = new Date("2026-03-01T00:00:00Z");
  const rangeEnd = new Date("2026-04-01T00:00:00Z");

  it("keeps valid neighbors when one VEVENT has an invalid datetime", () => {
    const parsed = parseVEventsInRangeDetailed(calendar([
      vevent(["UID:good-1", "DTSTART:20260315T100000Z", "DTEND:20260315T110000Z"]),
      vevent(["UID:bad", "DTSTART:20260315T25", "DTEND:20260315T260000"]),
      vevent(["UID:good-2", "DTSTART:20260316T100000Z", "DTEND:20260316T110000Z"]),
    ]), "/mixed.ics", rangeStart, rangeEnd);

    expect(parsed.events.map((event) => event.uid)).toEqual(["good-1", "good-2"]);
    expect(parsed.diagnostics).toEqual({ unreadableComponentCount: 1, unreadableObjectCount: 0 });
  });

  it("isolates an inconsistent VALUE=DATE and TZID component", () => {
    const parsed = parseVEventsInRangeDetailed(calendar([
      vevent(["UID:good", "DTSTART:20260315T100000Z", "DTEND:20260315T110000Z"]),
      vevent(["UID:bad-date", "DTSTART;VALUE=DATE;TZID=Europe/Moscow:20260315", "DTEND;VALUE=DATE:20260316"]),
    ]), "/mixed-value.ics", rangeStart, rangeEnd);

    expect(parsed.events.map((event) => event.uid)).toEqual(["good"]);
    expect(parsed.diagnostics.unreadableComponentCount).toBe(1);
  });

  it("marks a non-calendar DAV payload as an unreadable object", () => {
    const parsed = parseVEventsInRangeDetailed("not an iCalendar object", "/broken.ics", rangeStart, rangeEnd);
    expect(parsed.events).toEqual([]);
    expect(parsed.diagnostics).toEqual({ unreadableComponentCount: 0, unreadableObjectCount: 1 });
  });
});

describe("current ICS time boundary", () => {
  it("parses quoted parameters containing a colon and LF folding", () => {
    expect(parseICalContentLine('DESCRIPTION;ALTREP="https://ex.test/desc":Body')?.params.ALTREP)
      .toBe("https://ex.test/desc");
    const parsed = parseVEvent("BEGIN:VEVENT\nUID:folded\nDTSTART:20260315T100000Z\nDTEND:20260315T110000Z\nDESCRIPTION:Long\n continuation\nEND:VEVENT");
    expect(parsed.description).toBe("Longcontinuation");
  });

  it("round-trips TZID, all-day, and semantic metadata", () => {
    const original = eventWith(
      "DTSTART;TZID=America/New_York:20260315T100000",
      "DTEND;TZID=America/New_York:20260315T110000",
      "TRANSP:TRANSPARENT",
      "SEQUENCE:4",
    );
    const parsed = parseVEvent(original);
    const serialized = updateVEventFields(original, {
      time: parsed.time,
      transparency: parsed.transparency ?? undefined,
      sequence: parsed.sequence,
    });
    expect(serialized).toContain("DTSTART;TZID=America/New_York:20260315T100000");
    expect(parseVEvent(serialized).time).toEqual(parsed.time);

    const allDay = parseVEvent(generateVEvent({
      summary: "All day",
      startTime: "2026-03-15",
      endTime: "2026-03-16",
      isAllDay: true,
    }));
    expect(allDay.time).toEqual({ kind: "all-day", startDate: "2026-03-15", endDateExclusive: "2026-03-16" });
  });
});

function eventWith(...properties: string[]): string {
  return calendar([vevent(["UID:fixture", ...properties])]);
}

function vevent(properties: string[]): string {
  return ["BEGIN:VEVENT", ...properties, "END:VEVENT"].join("\r\n");
}

function calendar(events: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");
}
