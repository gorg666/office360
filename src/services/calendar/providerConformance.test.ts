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

  it("normalizes equivalent Google and CalDAV reminder metadata to one contract", () => {
    const google = mapGoogleEvent({
      id: "google-reminders", start: { dateTime: "2026-03-15T10:00:00Z" }, end: { dateTime: "2026-03-15T11:00:00Z" },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 15 }, { method: "email", minutes: 1440 }] },
    });
    const caldav = parseVEvent([
      "BEGIN:VEVENT", "UID:caldav-reminders", "DTSTART:20260315T100000Z", "DTEND:20260315T110000Z",
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Popup", "END:VALARM",
      "BEGIN:VALARM", "ACTION:EMAIL", "TRIGGER:-P1D", "DESCRIPTION:Email", "END:VALARM",
      "END:VEVENT",
    ].join("\r\n"));

    expect(google.reminders).toEqual(caldav.reminders);
  });

  it("declares actual provider capabilities explicitly", () => {
    expect(new GoogleCalendarProvider("account").capabilities).toMatchObject({
      version: 4,
      read: { calendars: "full", events: "full" },
      events: { create: "remote", update: "remote", delete: "remote" },
      recurrence: {
        read: "full", write: "partial",
        updateScopes: ["single", "series"], deleteScopes: ["single", "series"],
      },
      rsvp: { local: "projection", remote: "direct" },
      invitations: "none", freeBusy: { self: "local-derived", others: "remote" }, conflictDetection: "etag",
      sync: { mode: "sync-token", pagination: true, durability: "ephemeral" },
      reminders: { read: "full", write: "full", multiple: true, methods: ["notification", "email"], defaults: "inherit", maxCount: 5 },
    });
    expect(new CalDAVProvider("account").capabilities).toMatchObject({
      version: 4,
      read: { calendars: "full", events: "full" },
      events: { create: "remote", update: "remote", delete: "remote" },
      recurrence: {
        read: "full", write: "partial",
        updateScopes: ["single", "series"], deleteScopes: ["single", "series"],
      },
      rsvp: { local: "projection", remote: "direct" },
      invitations: "none", freeBusy: { self: "local-derived", others: "none" }, conflictDetection: "etag",
      sync: { mode: "range-refresh", pagination: false, durability: "ephemeral" },
      reminders: { read: "partial", write: "partial", multiple: true, methods: ["notification"], defaults: "none", maxCount: null },
    });
  });
});
