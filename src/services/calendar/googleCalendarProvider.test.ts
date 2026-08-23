import { GoogleCalendarProvider, mapDomainRemindersToGoogle, mapGoogleEvent, mapGoogleReminders } from "./googleCalendarProvider";
import { getGmailClient } from "@/services/gmail/tokenManager";

vi.mock("@/services/gmail/tokenManager", () => ({
  getGmailClient: vi.fn(),
}));

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

function createMockClient() {
  return { request: vi.fn() };
}

describe("GoogleCalendarProvider", () => {
  const accountId = "test-account-1";
  let provider: GoogleCalendarProvider;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
    vi.mocked(getGmailClient).mockResolvedValue(mockClient as never);
    provider = new GoogleCalendarProvider(accountId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("listCalendars", () => {
    it("maps Google API response to CalendarInfo array", async () => {
      mockClient.request.mockResolvedValue({
        items: [
          { id: "primary", summary: "My Calendar", backgroundColor: "#0000ff", primary: true },
          { id: "work@example.com", summary: "Work", accessRole: "owner" },
        ],
      });

      const result = await provider.listCalendars();

      expect(mockClient.request).toHaveBeenCalledWith(
        `${CALENDAR_API_BASE}/users/me/calendarList?maxResults=250`,
      );
      expect(result).toMatchObject([
        { remoteId: "primary", displayName: "My Calendar", color: "#0000ff", isPrimary: true, access: { role: "owner", ownership: "primary" } },
        { remoteId: "work@example.com", displayName: "Work", color: null, isPrimary: false, access: { role: "owner", ownership: "owned" } },
      ]);
    });

    it("returns empty array when no items", async () => {
      mockClient.request.mockResolvedValue({});

      const result = await provider.listCalendars();

      expect(result).toEqual([]);
    });

    it("normalizes effective access roles across all CalendarList pages", async () => {
      mockClient.request
        .mockResolvedValueOnce({
          items: [
            { id: "owner", summary: "Owner", accessRole: "owner" },
            { id: "writer", summary: "Writer", accessRole: "writer" },
          ],
          nextPageToken: "page-2",
        })
        .mockResolvedValueOnce({
          items: [
            { id: "reader", summary: "Reader", accessRole: "reader" },
            { id: "busy", summary: "Busy", accessRole: "freeBusyReader" },
          ],
        });

      const result = await provider.listCalendars();

      expect(result.map((calendar) => calendar.access.role)).toEqual(["owner", "editor", "viewer", "free-busy-only"]);
      expect(mockClient.request).toHaveBeenLastCalledWith(expect.stringContaining("pageToken=page-2"));
    });
  });

  describe("fetchEvents", () => {
    it("passes correct URL params and maps events", async () => {
      const googleEvent = {
        id: "evt-1",
        summary: "Meeting",
        description: "Discuss plans",
        location: "Room A",
        start: { dateTime: "2025-06-15T10:00:00Z" },
        end: { dateTime: "2025-06-15T11:00:00Z" },
        status: "confirmed",
        organizer: { email: "org@example.com" },
        attendees: [{ email: "a@example.com", responseStatus: "accepted" }],
        htmlLink: "https://calendar.google.com/event/evt-1",
        iCalUID: "uid-1@google.com",
        etag: '"etag-1"',
      };

      mockClient.request.mockResolvedValue({ items: [googleEvent] });

      const result = await provider.fetchEvents("cal-id", "2025-06-01T00:00:00Z", "2025-06-30T23:59:59Z");

      const calledUrl = mockClient.request.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/calendars/cal-id/events?");
      expect(calledUrl).toContain("timeMin=2025-06-01T00%3A00%3A00Z");
      expect(calledUrl).toContain("timeMax=2025-06-30T23%3A59%3A59Z");
      expect(calledUrl).toContain("singleEvents=true");
      expect(calledUrl).toContain("orderBy=startTime");
      expect(calledUrl).toContain("maxResults=250");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        remoteEventId: "evt-1",
        summary: "Meeting",
        description: "Discuss plans",
        location: "Room A",
        isAllDay: false,
        status: "confirmed",
        organizerEmail: "org@example.com",
        htmlLink: "https://calendar.google.com/event/evt-1",
        uid: "uid-1@google.com",
        etag: '"etag-1"',
      });
      expect(result[0].startTime).toBe(Math.floor(new Date("2025-06-15T10:00:00Z").getTime() / 1000));
      expect(result[0].endTime).toBe(Math.floor(new Date("2025-06-15T11:00:00Z").getTime() / 1000));
    });

    it("encodes calendar ID in URL", async () => {
      mockClient.request.mockResolvedValue({ items: [] });

      await provider.fetchEvents("user@example.com", "2025-01-01T00:00:00Z", "2025-01-31T23:59:59Z");

      const calledUrl = mockClient.request.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/calendars/user%40example.com/events?");
    });

    it("normalizes provider defaults, disabled reminders and multiple overrides", () => {
      expect(mapGoogleReminders(undefined)).toEqual({ policy: { kind: "inherit" }, diagnostics: [] });
      expect(mapGoogleReminders({ useDefault: true })).toEqual({ policy: { kind: "inherit" }, diagnostics: [] });
      expect(mapGoogleReminders({ useDefault: false, overrides: [] })).toEqual({ policy: { kind: "none" }, diagnostics: [] });
      expect(mapGoogleReminders({
        useDefault: false,
        overrides: [{ method: "popup", minutes: 10 }, { method: "email", minutes: 1440 }],
      }).policy).toEqual({
        kind: "custom",
        reminders: [
          { method: "email", trigger: { kind: "before-start", duration: { seconds: 86400 } } },
          { method: "notification", trigger: { kind: "before-start", duration: { seconds: 600 } } },
        ],
      });
    });

    it("keeps malformed provider reminder metadata diagnostic and the event readable", () => {
      const event = mapGoogleEvent({
        id: "bad-reminder", start: { dateTime: "2026-03-15T10:00:00Z" }, end: { dateTime: "2026-03-15T11:00:00Z" },
        reminders: { useDefault: false, overrides: [{ method: "sms", minutes: 5 }, { method: "popup", minutes: -1 }] },
      });
      expect(event.reminders).toEqual({ kind: "none" });
      expect(event.reminderDiagnostics).toEqual([
        { code: "unsupported-method", action: "sms" },
        { code: "invalid-trigger", action: "popup" },
      ]);
    });

    it("follows all event-list pages in order", async () => {
      const event = (id: string) => ({
        id,
        summary: id,
        start: { dateTime: "2025-06-15T10:00:00Z" },
        end: { dateTime: "2025-06-15T11:00:00Z" },
      });
      mockClient.request
        .mockResolvedValueOnce({ items: [event("page-1")], nextPageToken: "token-2" })
        .mockResolvedValueOnce({ items: [event("page-2")], nextPageToken: "token-3" })
        .mockResolvedValueOnce({ items: [event("page-3")] });

      const result = await provider.fetchEvents("cal-1", "2025-06-01T00:00:00Z", "2025-07-01T00:00:00Z");

      expect(result.map((item) => item.remoteEventId)).toEqual(["page-1", "page-2", "page-3"]);
      expect(mockClient.request).toHaveBeenCalledTimes(3);
      expect(mockClient.request.mock.calls[1][0]).toContain("pageToken=token-2");
      expect(mockClient.request.mock.calls[2][0]).toContain("pageToken=token-3");
    });

    it("accepts an empty final page", async () => {
      mockClient.request
        .mockResolvedValueOnce({ items: [], nextPageToken: "final-empty" })
        .mockResolvedValueOnce({ items: [] });

      await expect(provider.fetchEvents("cal-1", "2025-06-01T00:00:00Z", "2025-07-01T00:00:00Z"))
        .resolves.toEqual([]);
      expect(mockClient.request).toHaveBeenCalledTimes(2);
    });

    it("rejects the whole fetch when a later page fails", async () => {
      mockClient.request
        .mockResolvedValueOnce({ items: [], nextPageToken: "page-2" })
        .mockRejectedValueOnce(new Error("page 2 failed"));

      await expect(provider.fetchEvents("cal-1", "2025-06-01T00:00:00Z", "2025-07-01T00:00:00Z"))
        .rejects.toThrow("page 2 failed");
    });
  });

  describe("createEvent", () => {
    it("preserves a timed-zoned domain timezone in the write body", async () => {
      mockClient.request.mockResolvedValue({
        id: "zoned-evt",
        start: { dateTime: "2026-03-15T14:00:00Z", timeZone: "America/New_York" },
        end: { dateTime: "2026-03-15T15:00:00Z", timeZone: "America/New_York" },
      });

      await provider.createEvent("cal-1", {
        summary: "Zoned",
        startTime: "2026-03-15T14:00:00Z",
        endTime: "2026-03-15T15:00:00Z",
        time: {
          kind: "timed-zoned",
          start: { wall: { year: 2026, month: 3, day: 15, hour: 10, minute: 0, second: 0 }, tzid: "America/New_York", instant: 1_773_582_000 },
          end: { wall: { year: 2026, month: 3, day: 15, hour: 11, minute: 0, second: 0 }, tzid: "America/New_York", instant: 1_773_585_600 },
        },
      });

      const body = JSON.parse(mockClient.request.mock.calls[0][1].body as string);
      expect(body.start.timeZone).toBe("America/New_York");
      expect(body.end.timeZone).toBe("America/New_York");
    });

    it("sends POST with correct body and returns mapped event", async () => {
      const createdEvent = {
        id: "new-evt",
        summary: "Lunch",
        description: "Team lunch",
        location: "Cafe",
        start: { dateTime: "2025-06-20T12:00:00Z" },
        end: { dateTime: "2025-06-20T13:00:00Z" },
        status: "confirmed",
      };

      mockClient.request.mockResolvedValue(createdEvent);

      const result = await provider.createEvent("cal-1", {
        summary: "Lunch",
        description: "Team lunch",
        location: "Cafe",
        startTime: "2025-06-20T12:00:00Z",
        endTime: "2025-06-20T13:00:00Z",
      });

      const [url, options] = mockClient.request.mock.calls[0];
      expect(url).toBe(`${CALENDAR_API_BASE}/calendars/cal-1/events`);
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body as string);
      expect(body.summary).toBe("Lunch");
      expect(body.description).toBe("Team lunch");
      expect(body.location).toBe("Cafe");
      expect(body.start.dateTime).toBeDefined();
      expect(body.end.dateTime).toBeDefined();

      expect(result.remoteEventId).toBe("new-evt");
      expect(result.summary).toBe("Lunch");
    });

    it("creates all-day event with date-only start/end", async () => {
      mockClient.request.mockResolvedValue({
        id: "allday-evt",
        summary: "Holiday",
        start: { date: "2025-12-25" },
        end: { date: "2025-12-26" },
      });

      await provider.createEvent("cal-1", {
        summary: "Holiday",
        startTime: "2025-12-25T00:00:00Z",
        endTime: "2025-12-26T00:00:00Z",
        isAllDay: true,
      });

      const body = JSON.parse(mockClient.request.mock.calls[0][1].body as string);
      expect(body.start).toEqual({ date: "2025-12-25" });
      expect(body.end).toEqual({ date: "2025-12-26" });
    });

    it("includes attendees when provided", async () => {
      mockClient.request.mockResolvedValue({
        id: "evt-att",
        summary: "Sync",
        start: { dateTime: "2025-06-20T14:00:00Z" },
        end: { dateTime: "2025-06-20T15:00:00Z" },
      });

      await provider.createEvent("cal-1", {
        summary: "Sync",
        startTime: "2025-06-20T14:00:00Z",
        endTime: "2025-06-20T15:00:00Z",
        attendees: [{ email: "bob@example.com" }],
      });

      const body = JSON.parse(mockClient.request.mock.calls[0][1].body as string);
      expect(body.attendees).toEqual([{ email: "bob@example.com" }]);
    });

    it("sends RRULE on create and keeps it when Google omits recurrence in the response", async () => {
      mockClient.request.mockResolvedValue({
        id: "recurring-evt",
        summary: "Weekly",
        start: { dateTime: "2026-09-08T10:00:00Z" },
        end: { dateTime: "2026-09-08T11:00:00Z" },
      });

      const result = await provider.createEvent("cal-1", {
        summary: "Weekly",
        startTime: "2026-09-08T10:00:00Z",
        endTime: "2026-09-08T11:00:00Z",
        recurrenceRule: "FREQ=WEEKLY;BYDAY=TU,TH",
        attendees: [
          { email: "req@example.com", role: "required" },
          { email: "opt@example.com", role: "optional" },
        ],
      });

      const body = JSON.parse(mockClient.request.mock.calls[0][1].body as string);
      expect(body.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU,TH"]);
      expect(body.attendees).toEqual([
        { email: "req@example.com" },
        { email: "opt@example.com", optional: true },
      ]);
      expect(result.recurrenceRule).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
    });
  });

  describe("updateEvent", () => {
    it("patches one recurring instance directly", async () => {
      mockClient.request.mockResolvedValue({
        id: "instance-1", recurringEventId: "master-1", iCalUID: "series@example",
        originalStartTime: { dateTime: "2026-03-15T14:00:00Z", timeZone: "America/New_York" },
        start: { dateTime: "2026-03-15T15:00:00Z", timeZone: "America/New_York" },
        end: { dateTime: "2026-03-15T16:00:00Z", timeZone: "America/New_York" },
      });
      await provider.updateEvent("cal-1", "instance-1", { summary: "Moved instance" }, '"instance-etag"', {
        scope: "single", seriesUid: "series@example",
        occurrence: { key: "series%40example|Z|America%2FNew_York|20260315T100000", identity: { kind: "timed-zoned", tzid: "America/New_York", wall: { year: 2026, month: 3, day: 15, hour: 10, minute: 0, second: 0 } } },
      });
      expect(mockClient.request).toHaveBeenCalledTimes(1);
      expect(mockClient.request).toHaveBeenCalledWith(
        `${CALENDAR_API_BASE}/calendars/cal-1/events/instance-1`,
        expect.objectContaining({ method: "PATCH", headers: { "If-Match": '"instance-etag"' } }),
      );
    });

    it("writes explicit Google reminder policies without changing provider defaults implicitly", async () => {
      mockClient.request.mockResolvedValue({
        id: "evt-reminders", start: { dateTime: "2025-06-20T14:00:00Z" }, end: { dateTime: "2025-06-20T15:00:00Z" },
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }, { method: "email", minutes: 60 }] },
      });
      await provider.createEvent("cal-1", {
        summary: "Reminders", startTime: "2025-06-20T14:00:00Z", endTime: "2025-06-20T15:00:00Z",
        reminders: {
          kind: "custom",
          reminders: [
            { method: "notification", trigger: { kind: "before-start", duration: { seconds: 600 } } },
            { method: "email", trigger: { kind: "before-start", duration: { seconds: 3600 } } },
          ],
        },
      });

      const body = JSON.parse(mockClient.request.mock.calls[0][1].body as string);
      expect(body.reminders).toEqual({
        useDefault: false,
        overrides: [{ method: "email", minutes: 60 }, { method: "popup", minutes: 10 }],
      });
      expect(mapDomainRemindersToGoogle({ kind: "inherit" })).toEqual({ useDefault: true });
      expect(mapDomainRemindersToGoogle({ kind: "none" })).toEqual({ useDefault: false, overrides: [] });
    });

    it("resolves an instance to its master and preserves EXDATE/RDATE when changing RRULE", async () => {
      mockClient.request
        .mockResolvedValueOnce({ id: "instance-1", recurringEventId: "master-1", start: {}, end: {} })
        .mockResolvedValueOnce({ id: "master-1", etag: '"master-etag"', recurrence: ["RRULE:FREQ=WEEKLY", "EXDATE:20260315T100000Z", "RDATE:20260322T100000Z"], start: {}, end: {} })
        .mockResolvedValueOnce({ id: "master-1", recurrence: [], start: { dateTime: "2026-03-01T10:00:00Z" }, end: { dateTime: "2026-03-01T11:00:00Z" } });

      await provider.updateEvent("cal-1", "instance-1", { recurrenceRule: "FREQ=WEEKLY;COUNT=8" }, '"instance-etag"', {
        scope: "series", seriesUid: "series@example",
      });

      expect(mockClient.request.mock.calls[2][0]).toBe(`${CALENDAR_API_BASE}/calendars/cal-1/events/master-1`);
      expect(mockClient.request.mock.calls[2][1].headers).toEqual({ "If-Match": '"master-etag"' });
      expect(JSON.parse(mockClient.request.mock.calls[2][1].body as string).recurrence).toEqual([
        "RRULE:FREQ=WEEKLY;COUNT=8", "EXDATE:20260315T100000Z", "RDATE:20260322T100000Z",
      ]);
    });
    it("preserves timezone and advances the supplied sequence", async () => {
      mockClient.request.mockResolvedValue({
        id: "evt-1",
        sequence: 5,
        start: { dateTime: "2026-10-25T09:00:00Z", timeZone: "Europe/Moscow" },
        end: { dateTime: "2026-10-25T10:00:00Z", timeZone: "Europe/Moscow" },
      });

      await provider.updateEvent("cal-1", "evt-1", {
        sequence: 5,
        time: {
          kind: "timed-zoned",
          start: { wall: { year: 2026, month: 10, day: 25, hour: 12, minute: 0, second: 0 }, tzid: "Europe/Moscow", instant: 1_793_610_000 },
          end: { wall: { year: 2026, month: 10, day: 25, hour: 13, minute: 0, second: 0 }, tzid: "Europe/Moscow", instant: 1_793_613_600 },
        },
      });

      const body = JSON.parse(mockClient.request.mock.calls[0][1].body as string);
      expect(body.sequence).toBe(5);
      expect(body.start.timeZone).toBe("Europe/Moscow");
      expect(body.end.timeZone).toBe("Europe/Moscow");
    });

    it("sends PATCH with partial body", async () => {
      mockClient.request.mockResolvedValue({
        id: "evt-1",
        summary: "Updated Title",
        start: { dateTime: "2025-06-20T12:00:00Z" },
        end: { dateTime: "2025-06-20T13:00:00Z" },
      });

      const result = await provider.updateEvent("cal-1", "evt-1", {
        summary: "Updated Title",
      }, '"etag-old"');

      const [url, options] = mockClient.request.mock.calls[0];
      expect(url).toBe(`${CALENDAR_API_BASE}/calendars/cal-1/events/evt-1`);
      expect(options.method).toBe("PATCH");
      expect(options.headers).toEqual({ "If-Match": '"etag-old"' });

      const body = JSON.parse(options.body as string);
      expect(body.summary).toBe("Updated Title");
      expect(body.description).toBeUndefined();
      expect(body.start).toBeUndefined();
      expect(body.reminders).toBeUndefined();

      expect(result.remoteEventId).toBe("evt-1");
      expect(result.summary).toBe("Updated Title");
    });

    it("includes time fields when both startTime and endTime are provided", async () => {
      mockClient.request.mockResolvedValue({
        id: "evt-1",
        summary: "Rescheduled",
        start: { dateTime: "2025-06-21T09:00:00Z" },
        end: { dateTime: "2025-06-21T10:00:00Z" },
      });

      await provider.updateEvent("cal-1", "evt-1", {
        startTime: "2025-06-21T09:00:00Z",
        endTime: "2025-06-21T10:00:00Z",
      });

      const body = JSON.parse(mockClient.request.mock.calls[0][1].body as string);
      expect(body.start.dateTime).toBeDefined();
      expect(body.end.dateTime).toBeDefined();
    });
  });

  describe("deleteEvent", () => {
    it("resolves a recurring instance before deleting the whole series", async () => {
      mockClient.request
        .mockResolvedValueOnce({ id: "instance-1", recurringEventId: "master-1", start: {}, end: {} })
        .mockResolvedValueOnce({ id: "master-1", etag: '"master-etag"', start: {}, end: {} })
        .mockResolvedValueOnce(undefined);

      await provider.deleteEvent("cal-1", "instance-1", '"instance-etag"', { scope: "series", seriesUid: "series@example" });

      expect(mockClient.request).toHaveBeenNthCalledWith(3,
        `${CALENDAR_API_BASE}/calendars/cal-1/events/master-1`,
        { method: "DELETE", headers: { "If-Match": '"master-etag"' } },
      );
    });
    it("sends DELETE request with correct URL", async () => {
      mockClient.request.mockResolvedValue(undefined);

      await provider.deleteEvent("cal-1", "evt-1", '"etag-delete"');

      const [url, options] = mockClient.request.mock.calls[0];
      expect(url).toBe(`${CALENDAR_API_BASE}/calendars/cal-1/events/evt-1`);
      expect(options.method).toBe("DELETE");
      expect(options.headers).toEqual({ "If-Match": '"etag-delete"' });
    });

    it("encodes calendar and event IDs", async () => {
      mockClient.request.mockResolvedValue(undefined);

      await provider.deleteEvent("user@example.com", "evt/special");

      const calledUrl = mockClient.request.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/calendars/user%40example.com/events/evt%2Fspecial");
    });
  });

  describe("respondToEvent", () => {
    it("uses If-Match for a remote RSVP update", async () => {
      mockClient.request
        .mockResolvedValueOnce({ attendees: [{ email: "self@example.com", responseStatus: "needsAction" }] })
        .mockResolvedValueOnce(undefined);

      await provider.respondToEvent("cal-1", "evt-1", "self@example.com", "accepted", '"rsvp-etag"');

      expect(mockClient.request).toHaveBeenNthCalledWith(2,
        `${CALENDAR_API_BASE}/calendars/cal-1/events/evt-1?sendUpdates=all`,
        expect.objectContaining({ method: "PATCH", headers: { "If-Match": '"rsvp-etag"' } }),
      );
      const body = JSON.parse(mockClient.request.mock.calls[1][1].body as string);
      expect(body.attendees[0].responseStatus).toBe("accepted");
    });
  });

  describe("syncEvents", () => {
    it("uses syncToken for incremental sync and handles cancelled events as deletions", async () => {
      mockClient.request.mockResolvedValue({
        items: [
          {
            id: "evt-updated",
            summary: "Updated Event",
            start: { dateTime: "2025-06-15T10:00:00Z" },
            end: { dateTime: "2025-06-15T11:00:00Z" },
            status: "confirmed",
          },
          {
            id: "evt-deleted",
            summary: undefined,
            start: { dateTime: "2025-06-15T10:00:00Z" },
            end: { dateTime: "2025-06-15T11:00:00Z" },
            status: "cancelled",
          },
        ],
        nextSyncToken: "new-sync-token-123",
      });

      const result = await provider.syncEvents("cal-1", "old-sync-token");

      const calledUrl = mockClient.request.mock.calls[0][0] as string;
      expect(calledUrl).toContain("syncToken=old-sync-token");
      expect(calledUrl).not.toContain("timeMin");
      expect(calledUrl).not.toContain("singleEvents");

      expect(result.created).toHaveLength(1);
      expect(result.created[0].remoteEventId).toBe("evt-updated");
      expect(result.deletedRemoteIds).toEqual(["evt-deleted"]);
      expect(result.newSyncToken).toBe("new-sync-token-123");
      expect(result.newCtag).toBeNull();
    });

    it("sets time range for initial sync without syncToken", async () => {
      mockClient.request.mockResolvedValue({
        items: [],
        nextSyncToken: "initial-token",
      });

      const result = await provider.syncEvents("cal-1");

      const calledUrl = mockClient.request.mock.calls[0][0] as string;
      expect(calledUrl).toContain("timeMin=");
      expect(calledUrl).toContain("timeMax=");
      expect(calledUrl).toContain("singleEvents=true");
      expect(calledUrl).not.toContain("syncToken");

      expect(result.newSyncToken).toBe("initial-token");
    });

    it("handles 410 error (expired sync token) gracefully", async () => {
      mockClient.request.mockRejectedValue(new Error("410 Gone: sync token expired"));

      const result = await provider.syncEvents("cal-1", "expired-token");

      expect(result).toEqual({
        created: [],
        updated: [],
        deletedRemoteIds: [],
        newSyncToken: null,
        newCtag: null,
      });
    });

    it("handles 'sync token' message in error gracefully", async () => {
      mockClient.request.mockRejectedValue(new Error("Invalid sync token"));

      const result = await provider.syncEvents("cal-1", "bad-token");

      expect(result).toEqual({
        created: [],
        updated: [],
        deletedRemoteIds: [],
        newSyncToken: null,
        newCtag: null,
      });
    });

    it("rethrows non-sync-token errors", async () => {
      mockClient.request.mockRejectedValue(new Error("Network error"));

      await expect(provider.syncEvents("cal-1", "token")).rejects.toThrow("Network error");
    });

    it("follows pagination with nextPageToken", async () => {
      mockClient.request
        .mockResolvedValueOnce({
          items: [
            { id: "evt-1", summary: "Page 1", start: { dateTime: "2025-06-15T10:00:00Z" }, end: { dateTime: "2025-06-15T11:00:00Z" } },
          ],
          nextPageToken: "page-2-token",
        })
        .mockResolvedValueOnce({
          items: [
            { id: "evt-2", summary: "Page 2", start: { dateTime: "2025-06-16T10:00:00Z" }, end: { dateTime: "2025-06-16T11:00:00Z" } },
          ],
          nextSyncToken: "final-sync-token",
        });

      const result = await provider.syncEvents("cal-1", "token");

      expect(mockClient.request).toHaveBeenCalledTimes(2);
      const secondUrl = mockClient.request.mock.calls[1][0] as string;
      expect(secondUrl).toContain("pageToken=page-2-token");

      expect(result.created).toHaveLength(2);
      expect(result.created[0].remoteEventId).toBe("evt-1");
      expect(result.created[1].remoteEventId).toBe("evt-2");
      expect(result.newSyncToken).toBe("final-sync-token");
    });
  });

  describe("testConnection", () => {
    it("returns success when listCalendars succeeds", async () => {
      mockClient.request.mockResolvedValue({ items: [] });

      const result = await provider.testConnection();

      expect(result).toEqual({ success: true, message: "Connected to Google Calendar" });
    });

    it("returns failure with error message on error", async () => {
      mockClient.request.mockRejectedValue(new Error("Unauthorized"));

      const result = await provider.testConnection();

      expect(result).toEqual({ success: false, message: "Unauthorized" });
    });

    it("returns generic failure message for non-Error throws", async () => {
      mockClient.request.mockRejectedValue("something went wrong");

      const result = await provider.testConnection();

      expect(result).toEqual({ success: false, message: "Connection failed" });
    });
  });
});
