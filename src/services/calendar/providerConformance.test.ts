import { CalDAVProvider } from "./caldavProvider";
import { GoogleCalendarProvider, mapGoogleEvent } from "./googleCalendarProvider";
import { parseVEvent, parseVEventsInRange } from "./icalHelper";
import { normalizeParticipantEmail } from "./domain";

describe("Calendar provider semantic conformance", () => {
  it("normalizes equivalent zoned events to one time contract", () => {
    const google = mapGoogleEvent({
      id: "google-timed",
      iCalUID: "timed-series",
      start: { dateTime: "2026-03-15T07:00:00Z", timeZone: "Europe/Moscow" },
      end: { dateTime: "2026-03-15T08:00:00Z", timeZone: "Europe/Moscow" },
    });
    const caldav = parseVEvent([
      "BEGIN:VEVENT", "UID:timed-series",
      "DTSTART;TZID=Europe/Moscow:20260315T100000",
      "DTEND;TZID=Europe/Moscow:20260315T110000", "END:VEVENT",
    ].join("\r\n"));

    expect(google.time).toEqual(caldav.time);
    expect(google.startTime).toBe(caldav.startTime);
    expect(google.seriesUid).toBe(caldav.seriesUid);
  });

  it("normalizes Google exclusive dates and CalDAV VALUE=DATE identically", () => {
    const google = mapGoogleEvent({
      id: "google-day", iCalUID: "day-series",
      start: { date: "2026-03-15" }, end: { date: "2026-03-16" },
    });
    const caldav = parseVEvent([
      "BEGIN:VEVENT", "UID:day-series",
      "DTSTART;VALUE=DATE:20260315", "DTEND;VALUE=DATE:20260316", "END:VEVENT",
    ].join("\r\n"));

    expect(google.time).toEqual(caldav.time);
    expect(google.startTime).toBe(caldav.startTime);
    expect(google.endTime).toBe(caldav.endTime);
  });

  it("uses the original recurrence wall identity for both providers", () => {
    const google = mapGoogleEvent({
      id: "instance-2", iCalUID: "weekly-series", recurringEventId: "master",
      originalStartTime: { dateTime: "2026-03-08T14:00:00Z", timeZone: "America/New_York" },
      start: { dateTime: "2026-03-08T16:00:00Z", timeZone: "America/New_York" },
      end: { dateTime: "2026-03-08T17:00:00Z", timeZone: "America/New_York" },
    });
    const caldav = parseVEventsInRange([
      "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:weekly-series",
      "DTSTART;TZID=America/New_York:20260301T100000",
      "DTEND;TZID=America/New_York:20260301T110000", "RRULE:FREQ=WEEKLY;COUNT=2", "END:VEVENT",
      "BEGIN:VEVENT", "UID:weekly-series",
      "RECURRENCE-ID;TZID=America/New_York:20260308T100000",
      "DTSTART;TZID=America/New_York:20260308T120000",
      "DTEND;TZID=America/New_York:20260308T130000", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n"), "/weekly.ics", new Date("2026-03-08T00:00:00Z"), new Date("2026-03-09T00:00:00Z"))[0]!;

    expect(google.occurrenceKey).toBe(caldav.occurrenceKey);
    expect(google.time).toEqual(caldav.time);
  });

  it("normalizes participant identity without changing display casing", () => {
    const google = mapGoogleEvent({
      id: "google-attendee", start: { date: "2026-03-15" }, end: { date: "2026-03-16" },
      attendees: [{ email: "  Person@Example.COM ", displayName: "Person" }],
    });
    const caldav = parseVEvent([
      "BEGIN:VEVENT", "UID:caldav-attendee", "DTSTART;VALUE=DATE:20260315", "DTEND;VALUE=DATE:20260316",
      "ATTENDEE;CN=Person:mailto:Person@Example.COM", "END:VEVENT",
    ].join("\r\n"));

    expect(google.participants[0]?.normalizedEmail).toBe(caldav.participants[0]?.normalizedEmail);
    expect(google.participants[0]?.value).toBe("Person@Example.COM");
    expect(normalizeParticipantEmail(" MAILTO:Person@Example.COM ")).toBe("person@example.com");
  });

  it("declares actual provider capabilities explicitly", () => {
    expect(new GoogleCalendarProvider("account").capabilities).toMatchObject({
      recurrence: { read: true, scopes: ["instance", "series"] }, freeBusy: "native",
      sync: { mode: "sync-token", pagination: true },
    });
    expect(new CalDAVProvider("account").capabilities).toMatchObject({
      recurrence: { read: true, scopes: ["series"] }, freeBusy: "none",
      sync: { mode: "range-refresh", pagination: false },
    });
  });
});
