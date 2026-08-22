vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: globalThis.fetch.bind(globalThis),
}));

import { CalDAVProvider, isCalDavAuthFailure } from "./caldavProvider";
import { getAccount, type DbAccount } from "@/services/db/accounts";
import { ensureFreshToken } from "@/services/oauth/oauthTokenManager";

const MOCK_ICAL_DATA =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test-uid\r\nSUMMARY:Test Event\r\nDTSTART:20240101T100000Z\r\nDTEND:20240101T110000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";

const MOCK_ICAL_DATA_2 =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test-uid-2\r\nSUMMARY:Second Event\r\nDTSTART:20240102T140000Z\r\nDTEND:20240102T150000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";

const mockLogin = vi.fn().mockResolvedValue(undefined);
const mockFetchCalendars = vi.fn();
const mockFetchCalendarObjects = vi.fn();
const mockCreateCalendarObject = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
const mockUpdateCalendarObject = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
const mockDeleteCalendarObject = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
const mockPropfind = vi.fn();
const mockDavRequest = vi.fn();
const mockDavFetch = vi.fn();

vi.mock("tsdav", () => {
  const MockDAVClient = vi.fn(function (this: Record<string, unknown>) {
    this.login = mockLogin;
    this.fetchCalendars = mockFetchCalendars;
    this.fetchCalendarObjects = mockFetchCalendarObjects;
    this.createCalendarObject = mockCreateCalendarObject;
    this.updateCalendarObject = mockUpdateCalendarObject;
    this.deleteCalendarObject = mockDeleteCalendarObject;
    this.account = { rootUrl: "https://caldav.example.com/", principalUrl: "https://caldav.example.com/principal/" };
    this.propfind = mockPropfind;
    this.davRequest = mockDavRequest;
    this.fetchOverride = mockDavFetch;
  });
  return { DAVClient: MockDAVClient };
});

vi.mock("@/services/db/accounts", () => ({
  getAccount: vi.fn().mockResolvedValue({
    id: "acc-1",
    email: "user@example.com",
    provider: "imap",
    auth_method: "password",
    oauth_provider: null,
    caldav_url: "https://caldav.example.com",
    caldav_username: "user@example.com",
    caldav_password: "secret",
  }),
}));

vi.mock("@/services/oauth/oauthTokenManager", () => ({
  OAUTH_TOKEN_REFRESH_BUFFER_MS: 5 * 60 * 1000,
  ensureFreshToken: vi.fn().mockResolvedValue("oauth-token"),
}));

const BASIC_ACCOUNT = {
  id: "acc-1",
  email: "user@example.com",
  provider: "imap",
  auth_method: "password",
  oauth_provider: null,
  caldav_url: "https://caldav.example.com",
  caldav_username: "user@example.com",
  caldav_password: "secret",
} as DbAccount;

function createYandexAccount(overrides: Partial<DbAccount> = {}): DbAccount {
  return {
    id: "acc-yandex",
    email: "user@yandex.ru",
    display_name: null,
    avatar_url: null,
    access_token: "oauth-token",
    refresh_token: "refresh-token",
    token_expires_at: Math.floor(Date.now() / 1000) + 3600,
    history_id: null,
    last_sync_at: null,
    is_active: 1,
    created_at: 0,
    updated_at: 0,
    provider: "imap",
    imap_host: "imap.yandex.ru",
    imap_port: 993,
    imap_security: "ssl",
    smtp_host: "smtp.yandex.ru",
    smtp_port: 465,
    smtp_security: "ssl",
    auth_method: "oauth2",
    imap_password: null,
    oauth_provider: "yandex",
    oauth_client_id: "client-id",
    oauth_client_secret: null,
    imap_username: null,
    caldav_url: "https://caldav.yandex.ru/",
    caldav_username: "user@yandex.ru",
    caldav_password: null,
    caldav_principal_url: null,
    caldav_home_url: null,
    calendar_provider: "caldav",
    accept_invalid_certs: 0,
    ...overrides,
  };
}

describe("CalDAVProvider", () => {
  let provider: CalDAVProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccount).mockReset().mockResolvedValue({ ...BASIC_ACCOUNT });
    vi.mocked(ensureFreshToken).mockReset().mockResolvedValue("oauth-token");
    mockLogin.mockReset().mockResolvedValue(undefined);
    mockFetchCalendars.mockReset();
    mockFetchCalendarObjects.mockReset();
    mockCreateCalendarObject.mockReset().mockResolvedValue(new Response(null, { status: 201 }));
    mockUpdateCalendarObject.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
    mockDeleteCalendarObject.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
    mockPropfind.mockReset();
    mockDavRequest.mockReset();
    mockDavFetch.mockReset();
    provider = new CalDAVProvider("acc-1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("session lifecycle", () => {
    it("reuses one Yandex OAuth login across sequential provider operations", async () => {
      const account = createYandexAccount();
      vi.mocked(getAccount).mockResolvedValue(account);
      vi.mocked(ensureFreshToken).mockImplementation(async (current) => current.access_token ?? "");
      mockFetchCalendars.mockResolvedValue([]);
      mockFetchCalendarObjects.mockResolvedValue([]);
      const yandexProvider = new CalDAVProvider(account.id);

      await yandexProvider.listCalendars();
      await yandexProvider.fetchEvents(
        "/cal/main/",
        "2024-01-01T00:00:00Z",
        "2024-01-31T23:59:59Z",
      );

      expect(ensureFreshToken).toHaveBeenCalledTimes(1);
      expect(mockLogin).toHaveBeenCalledTimes(1);
    });

    it("single-flights concurrent Yandex OAuth session creation", async () => {
      const account = createYandexAccount();
      vi.mocked(getAccount).mockResolvedValue(account);
      vi.mocked(ensureFreshToken).mockImplementation(async (current) => current.access_token ?? "");
      mockLogin.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      mockFetchCalendars.mockResolvedValue([]);
      const yandexProvider = new CalDAVProvider(account.id);

      await Promise.all(Array.from({ length: 5 }, () => yandexProvider.listCalendars()));

      expect(ensureFreshToken).toHaveBeenCalledTimes(1);
      expect(mockLogin).toHaveBeenCalledTimes(1);
      expect(mockFetchCalendars).toHaveBeenCalledTimes(5);
    });

    it("clears failed creation so the next request can retry", async () => {
      mockLogin.mockRejectedValueOnce(new Error("Network down"));
      mockFetchCalendars.mockResolvedValue([]);
      const retryingProvider = new CalDAVProvider("acc-1");

      await expect(retryingProvider.listCalendars()).rejects.toThrow("Network down");
      await expect(retryingProvider.listCalendars()).resolves.toEqual([]);

      expect(mockLogin).toHaveBeenCalledTimes(2);
    });

    it("recreates an OAuth session when credential expiry enters the refresh margin", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-21T12:00:00Z"));
      const account = createYandexAccount({
        token_expires_at: Math.floor(Date.now() / 1000) + 6 * 60,
      });
      vi.mocked(getAccount).mockResolvedValue(account);
      vi.mocked(ensureFreshToken).mockImplementation(async (current) => {
        if ((current.token_expires_at ?? 0) * 1000 - Date.now() <= 5 * 60 * 1000) {
          current.access_token = "refreshed-token";
          current.token_expires_at = Math.floor(Date.now() / 1000) + 3600;
        }
        return current.access_token ?? "";
      });
      mockFetchCalendars.mockResolvedValue([]);
      const yandexProvider = new CalDAVProvider(account.id);

      await yandexProvider.listCalendars();
      vi.advanceTimersByTime(2 * 60 * 1000);
      await yandexProvider.listCalendars();

      expect(ensureFreshToken).toHaveBeenCalledTimes(2);
      expect(mockLogin).toHaveBeenCalledTimes(2);
    });

    it("invalidates, force-refreshes, and retries an auth failure once", async () => {
      const account = createYandexAccount();
      vi.mocked(getAccount).mockResolvedValue(account);
      vi.mocked(ensureFreshToken).mockImplementation(async (current, options) => {
        if (options?.forceRefresh) {
          current.access_token = "refreshed-token";
          current.token_expires_at = Math.floor(Date.now() / 1000) + 3600;
        }
        return current.access_token ?? "";
      });
      mockFetchCalendars.mockResolvedValue([]);
      const yandexProvider = new CalDAVProvider(account.id);
      await yandexProvider.listCalendars();

      mockFetchCalendars
        .mockRejectedValueOnce(new Error("Collection query failed: 401 Unauthorized"))
        .mockResolvedValueOnce([{ url: "/cal/main/", displayName: "Main" }]);

      await expect(yandexProvider.listCalendars()).resolves.toHaveLength(1);

      expect(ensureFreshToken).toHaveBeenCalledTimes(2);
      expect(ensureFreshToken).toHaveBeenLastCalledWith(account, { forceRefresh: true });
      expect(mockLogin).toHaveBeenCalledTimes(2);
      expect(mockFetchCalendars).toHaveBeenCalledTimes(3);
    });

    it("does not invalidate the session for a discovery-like 404 or permission-only 403", async () => {
      mockFetchCalendars.mockResolvedValue([]);
      mockFetchCalendarObjects.mockRejectedValueOnce(
        new Error("Collection query failed: 404 Not Found"),
      );

      await provider.listCalendars();
      await expect(provider.fetchEvents(
        "/cal/main/",
        "2024-01-01T00:00:00Z",
        "2024-01-31T23:59:59Z",
      )).rejects.toThrow("404 Not Found");
      mockCreateCalendarObject.mockResolvedValueOnce(new Response("Forbidden", {
        status: 403,
        statusText: "Forbidden",
      }));
      await expect(provider.createEvent("/cal/main/", {
        summary: "Blocked",
        startTime: "2024-03-15T09:00:00Z",
        endTime: "2024-03-15T10:00:00Z",
      })).rejects.toThrow("403");
      await provider.listCalendars();

      expect(mockLogin).toHaveBeenCalledTimes(1);
      expect(isCalDavAuthFailure(new Error("Collection query failed: 404 Not Found"))).toBe(false);
      expect(isCalDavAuthFailure(new Error("CalDAV create failed (403): Forbidden"))).toBe(false);
      expect(isCalDavAuthFailure(new Error("CalDAV request failed (403): invalid token"))).toBe(true);
    });

    it("redacts session identifiers and credentials from diagnostics", async () => {
      const account = createYandexAccount();
      vi.mocked(getAccount).mockResolvedValue(account);
      vi.mocked(ensureFreshToken).mockImplementation(async (current) => current.access_token ?? "");
      mockFetchCalendars.mockResolvedValue([]);
      const info = vi.spyOn(console, "info").mockImplementation(() => {});

      await new CalDAVProvider(account.id).listCalendars();

      const diagnostics = JSON.stringify(info.mock.calls);
      expect(diagnostics).toContain("[redacted]");
      expect(diagnostics).not.toContain(account.id);
      expect(diagnostics).not.toContain(account.email);
      expect(diagnostics).not.toContain(account.access_token);
      info.mockRestore();
    });
  });

  describe("remote free/busy discovery", () => {
    function supportedDiscovery(): void {
      mockPropfind.mockResolvedValue([{ ok: true, props: {
        scheduleInboxURL: { href: "/inbox/" },
        scheduleOutboxURL: { href: "/outbox/" },
        calendarUserAddressSet: { href: ["mailto:self@example.com"] },
      } }]);
      mockDavFetch.mockResolvedValue(new Response(null, {
        status: 200,
        headers: { DAV: "1, 3, calendar-access, calendar-auto-schedule" },
      }));
    }

    it("enables generic CalDAV only after RFC 6638 properties and DAV token are present", async () => {
      supportedDiscovery();
      await expect(provider.discoverRemoteFreeBusy()).resolves.toMatchObject({
        supported: true,
        autoSchedule: true,
        scheduleOutboxUrl: "https://caldav.example.com/outbox/",
        calendarUserAddresses: ["mailto:self@example.com"],
        reason: "supported",
      });
      expect(provider.capabilities.freeBusy.others).toBe("remote");
      expect(mockPropfind).toHaveBeenCalledWith(expect.objectContaining({
        url: "https://caldav.example.com/principal/",
        depth: "0",
      }));
    });

    it("keeps a server without scheduling outbox unsupported", async () => {
      mockPropfind.mockResolvedValue([{ ok: true, props: {
        calendarUserAddressSet: { href: ["mailto:self@example.com"] },
      } }]);
      mockDavFetch.mockResolvedValue(new Response(null, { status: 200, headers: { DAV: "calendar-access" } }));
      await expect(provider.discoverRemoteFreeBusy()).resolves.toMatchObject({
        supported: false,
        reason: "missing-outbox",
      });
    });

    it("does not trust a scheduling DAV token from a failed OPTIONS response", async () => {
      supportedDiscovery();
      mockDavFetch.mockResolvedValue(new Response(null, {
        status: 403,
        headers: { DAV: "calendar-access, calendar-auto-schedule" },
      }));

      await expect(provider.discoverRemoteFreeBusy()).resolves.toMatchObject({
        supported: false,
        autoSchedule: false,
        reason: "missing-auto-schedule",
      });
      expect(provider.capabilities.freeBusy.others).toBe("none");
    });

    it("performs read-only Yandex discovery but does not claim remote support", async () => {
      supportedDiscovery();
      vi.mocked(getAccount).mockResolvedValue(createYandexAccount());
      const yandex = new CalDAVProvider("acc-yandex");
      await expect(yandex.discoverRemoteFreeBusy()).resolves.toMatchObject({
        supported: false,
        autoSchedule: true,
        reason: "yandex-unconfirmed",
      });
      expect(yandex.capabilities.freeBusy.others).toBe("none");
      expect(mockDavRequest).not.toHaveBeenCalled();
    });

    it("posts VFREEBUSY to the discovered outbox and returns only busy geometry", async () => {
      supportedDiscovery();
      mockDavRequest.mockResolvedValue([{ ok: true, status: 200, raw: `<?xml version="1.0"?>
        <c:schedule-response xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:">
          <c:response><c:recipient><d:href>mailto:other@example.com</d:href></c:recipient>
          <c:request-status>2.0;Success</c:request-status><c:calendar-data><![CDATA[
BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VFREEBUSY\r\nFREEBUSY:20260822T100000Z/20260822T110000Z\r\nEND:VFREEBUSY\r\nEND:VCALENDAR
          ]]></c:calendar-data></c:response>
        </c:schedule-response>` }]);

      const result = await provider.queryRemoteFreeBusy(["other@example.com"], {
        start: Date.parse("2026-08-22T00:00:00Z") / 1000,
        end: Date.parse("2026-08-23T00:00:00Z") / 1000,
      });

      expect(result).toEqual([{
        recipient: "other@example.com",
        status: "known",
        busy: [{
          start: Date.parse("2026-08-22T10:00:00Z") / 1000,
          end: Date.parse("2026-08-22T11:00:00Z") / 1000,
          busyType: "busy",
        }],
      }]);
      const call = mockDavRequest.mock.calls[0][0];
      expect(call.url).toBe("https://caldav.example.com/outbox/");
      expect(call.init.body).toContain("ATTENDEE:mailto:other@example.com");
      expect(call.init.body).not.toContain("SUMMARY");
    });
  });

  describe("listCalendars", () => {
    it("maps tsdav calendars to CalendarInfo array", async () => {
      mockFetchCalendars.mockResolvedValue([
        { url: "/cal/personal/", displayName: "Personal" },
        { url: "/cal/work/", displayName: "Work", calendarColor: "#ff0000" },
      ]);

      const calendars = await provider.listCalendars();

      expect(calendars).toEqual([
        { remoteId: "/cal/personal/", displayName: "Personal", color: null, isPrimary: true },
        { remoteId: "/cal/work/", displayName: "Work", color: "#ff0000", isPrimary: false },
      ]);
    });

    it("handles non-string displayName by falling back to indexed name", async () => {
      mockFetchCalendars.mockResolvedValue([
        { url: "/cal/unnamed/", displayName: undefined },
        { url: "/cal/also-unnamed/", displayName: null },
      ]);

      const calendars = await provider.listCalendars();

      expect(calendars[0]!.displayName).toBe("Calendar 1");
      expect(calendars[1]!.displayName).toBe("Calendar 2");
    });
  });

  describe("fetchEvents", () => {
    it("passes time range and parses iCalendar data from objects", async () => {
      mockFetchCalendarObjects.mockResolvedValue([
        { data: MOCK_ICAL_DATA, url: "/cal/personal/test-uid.ics", etag: '"etag-1"' },
        { data: MOCK_ICAL_DATA_2, url: "/cal/personal/test-uid-2.ics", etag: '"etag-2"' },
      ]);

      const events = await provider.fetchEvents("/cal/personal/", "2024-01-01T00:00:00Z", "2024-01-31T23:59:59Z");

      expect(mockFetchCalendarObjects).toHaveBeenCalledWith({
        calendar: { url: "/cal/personal/" },
        timeRange: { start: "2024-01-01T00:00:00Z", end: "2024-01-31T23:59:59Z" },
      });

      expect(events).toHaveLength(2);
      expect(events[0]!.summary).toBe("Test Event");
      expect(events[0]!.uid).toBe("test-uid");
      expect(events[0]!.etag).toBe('"etag-1"');
      expect(events[0]!.remoteEventId).toBe("/cal/personal/test-uid.ics");
      expect(events[1]!.summary).toBe("Second Event");
      expect(events[1]!.etag).toBe('"etag-2"');
    });

    it("filters out objects with no data", async () => {
      mockFetchCalendarObjects.mockResolvedValue([
        { data: MOCK_ICAL_DATA, url: "/cal/personal/test-uid.ics", etag: '"etag-1"' },
        { data: null, url: "/cal/personal/empty.ics", etag: null },
      ]);

      const events = await provider.fetchEvents("/cal/personal/", "2024-01-01T00:00:00Z", "2024-01-31T23:59:59Z");

      expect(events).toHaveLength(1);
    });

    it("skips one unreadable DAV object and keeps valid objects with safe diagnostics", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      mockFetchCalendarObjects.mockResolvedValue([
        { data: MOCK_ICAL_DATA, url: "/cal/personal/good.ics", etag: '"good"' },
        { data: "broken calendar payload", url: "/cal/personal/broken.ics", etag: '"bad"' },
      ]);

      const events = await provider.fetchEvents("/cal/personal/", "2024-01-01T00:00:00Z", "2024-01-31T23:59:59Z");

      expect(events).toHaveLength(1);
      expect(events[0]?.uid).toBe("test-uid");
      expect(provider.lastReadDiagnostics).toEqual({ unreadableComponentCount: 0, unreadableObjectCount: 1 });
      expect(console.warn).toHaveBeenCalledWith("[calendar-read]", expect.objectContaining({
        provider: "caldav",
        accountId: "[redacted]",
        unreadableObjectCount: 1,
      }));
    });
  });

  describe("createEvent", () => {
    it("generates iCalendar and calls createCalendarObject", async () => {
      vi.spyOn(crypto, "randomUUID").mockReturnValue("generated-uuid" as `${string}-${string}-${string}-${string}-${string}`);

      const event = await provider.createEvent("/cal/personal/", {
        summary: "New Meeting",
        startTime: "2024-03-15T09:00:00Z",
        endTime: "2024-03-15T10:00:00Z",
      });

      expect(mockCreateCalendarObject).toHaveBeenCalledWith({
        calendar: { url: "/cal/personal/" },
        filename: "generated-uuid.ics",
        iCalString: expect.stringContaining("SUMMARY:New Meeting"),
      });

      expect(event.summary).toBe("New Meeting");
      expect(event.remoteEventId).toBe("/cal/personal/generated-uuid.ics");
    });

    it("throws when CalDAV returns a failed create response", async () => {
      mockCreateCalendarObject.mockResolvedValueOnce(new Response("Forbidden", {
        status: 403,
        statusText: "Forbidden",
      }));

      await expect(provider.createEvent("/cal/personal/", {
        summary: "Blocked",
        startTime: "2024-03-15T09:00:00Z",
        endTime: "2024-03-15T10:00:00Z",
      })).rejects.toThrow("CalDAV create event failed (403): Forbidden");
    });
  });

  describe("updateEvent", () => {
    it("writes one occurrence override without changing the series master", async () => {
      const recurringData = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:series-1", "SUMMARY:Master",
        "DTSTART;TZID=Europe/Moscow:20260620T100000", "DTEND;TZID=Europe/Moscow:20260620T110000",
        "RRULE:FREQ=WEEKLY;COUNT=4", "END:VEVENT", "END:VCALENDAR",
      ].join("\r\n");
      mockFetchCalendarObjects.mockResolvedValue([{ data: recurringData, url: "/series.ics", etag: '"etag"' }]);

      await provider.updateEvent("/cal/", "/series.ics", { summary: "Only this" }, '"etag"', {
        scope: "single", seriesUid: "series-1",
        occurrence: { key: "series-1|Z|Europe%2FMoscow|20260627T100000", identity: { kind: "timed-zoned", tzid: "Europe/Moscow", wall: { year: 2026, month: 6, day: 27, hour: 10, minute: 0, second: 0 } } },
      });

      const written = mockUpdateCalendarObject.mock.calls[0][0].calendarObject.data as string;
      expect(written.match(/SUMMARY:Master/g)).toHaveLength(1);
      expect(written).toContain("RECURRENCE-ID;TZID=Europe/Moscow:20260627T100000");
      expect(written).toContain("SUMMARY:Only this");
      expect(written.match(/RRULE:/g)).toHaveLength(1);
    });

    it("preserves recurrence rules while advancing sequence", async () => {
      const recurringData = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:series-1",
        "DTSTART;TZID=Europe/Moscow:20260620T100000",
        "DTEND;TZID=Europe/Moscow:20260620T110000",
        "RRULE:FREQ=WEEKLY;COUNT=4", "SEQUENCE:3", "SUMMARY:Old", "END:VEVENT", "END:VCALENDAR",
      ].join("\r\n");
      mockFetchCalendarObjects.mockResolvedValue([{
        data: recurringData,
        url: "/cal/personal/series-1.ics",
        etag: '"series-etag"',
      }]);

      await provider.updateEvent(
        "/cal/personal/",
        "/cal/personal/series-1.ics",
        { summary: "Updated", sequence: 4 },
        '"series-etag"',
      );

      const written = mockUpdateCalendarObject.mock.calls[0][0].calendarObject.data as string;
      expect(written).toContain("RRULE:FREQ=WEEKLY;COUNT=4");
      expect(written).toContain("SEQUENCE:4");
      expect(written).not.toContain("SEQUENCE:3");
    });

    it("does not decrease an existing sequence from a stale caller", async () => {
      const source = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:event-1",
        "DTSTART:20260620T100000Z", "DTEND:20260620T110000Z",
        "SEQUENCE:7", "SUMMARY:Old", "END:VEVENT", "END:VCALENDAR",
      ].join("\r\n");
      mockFetchCalendarObjects.mockResolvedValue([{
        data: source, url: "/cal/personal/event-1.ics", etag: '"etag"',
      }]);

      await provider.updateEvent(
        "/cal/personal/", "/cal/personal/event-1.ics", { summary: "Updated", sequence: 3 }, '"etag"',
      );

      const written = mockUpdateCalendarObject.mock.calls[0][0].calendarObject.data as string;
      expect(written).toContain("SEQUENCE:7");
      expect(written).not.toContain("SEQUENCE:3");
    });

    it("fetches existing, merges updates, and calls updateCalendarObject", async () => {
      mockFetchCalendarObjects.mockResolvedValue([
        { data: MOCK_ICAL_DATA, url: "/cal/personal/test-uid.ics", etag: '"old-etag"' },
      ]);

      const event = await provider.updateEvent(
        "/cal/personal/",
        "/cal/personal/test-uid.ics",
        { summary: "Updated Event" },
        '"old-etag"',
      );

      expect(mockFetchCalendarObjects).toHaveBeenCalledWith({
        calendar: { url: "/cal/personal/" },
        objectUrls: ["/cal/personal/test-uid.ics"],
      });

      expect(mockUpdateCalendarObject).toHaveBeenCalledWith({
        calendarObject: {
          url: "/cal/personal/test-uid.ics",
          data: expect.stringContaining("SUMMARY:Updated Event"),
          etag: '"old-etag"',
        },
      });

      expect(event.summary).toBe("Updated Event");
      expect(event.remoteEventId).toBe("/cal/personal/test-uid.ics");
    });

    it("throws when the existing event is not found", async () => {
      mockFetchCalendarObjects.mockResolvedValue([]);

      await expect(
        provider.updateEvent("/cal/personal/", "/cal/personal/missing.ics", { summary: "Nope" }),
      ).rejects.toThrow("Event not found on server");
    });
  });

  describe("deleteEvent", () => {
    it("excludes one occurrence with an ETag-protected resource update", async () => {
      const recurring = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:series-1\r\nDTSTART;TZID=America/New_York:20260301T100000\r\nDTEND;TZID=America/New_York:20260301T110000\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nEND:VEVENT\r\nEND:VCALENDAR";
      mockFetchCalendarObjects.mockResolvedValue([{ url: "/series.ics", etag: '"server-etag"', data: recurring }]);

      await provider.deleteEvent("/cal/", "/series.ics", '"cached-etag"', {
        scope: "single", seriesUid: "series-1",
        occurrence: { key: "series-1|Z|America%2FNew_York|20260315T100000", identity: { kind: "timed-zoned", tzid: "America/New_York", wall: { year: 2026, month: 3, day: 15, hour: 10, minute: 0, second: 0 } } },
      });

      expect(mockDeleteCalendarObject).not.toHaveBeenCalled();
      const calendarObject = mockUpdateCalendarObject.mock.calls[0][0].calendarObject;
      expect(calendarObject.etag).toBe('"cached-etag"');
      expect(calendarObject.data).toContain("EXDATE;TZID=America/New_York:20260315T100000");
      expect(calendarObject.data).toContain("RRULE:FREQ=WEEKLY;COUNT=4");
    });
    it("calls deleteCalendarObject with etag", async () => {
      await provider.deleteEvent("/cal/personal/", "/cal/personal/test-uid.ics", '"delete-etag"');

      expect(mockDeleteCalendarObject).toHaveBeenCalledWith({
        calendarObject: {
          url: "/cal/personal/test-uid.ics",
          etag: '"delete-etag"',
        },
      });
    });

    it("calls deleteCalendarObject without etag when not provided", async () => {
      await provider.deleteEvent("/cal/personal/", "/cal/personal/test-uid.ics");

      expect(mockDeleteCalendarObject).toHaveBeenCalledWith({
        calendarObject: {
          url: "/cal/personal/test-uid.ics",
          etag: undefined,
        },
      });
    });
  });

  describe("syncEvents", () => {
    it("fetches all objects in time range and returns them as created events", async () => {
      mockFetchCalendarObjects.mockResolvedValue([
        { data: MOCK_ICAL_DATA, url: "/cal/personal/test-uid.ics", etag: '"sync-etag"' },
        { data: MOCK_ICAL_DATA_2, url: "/cal/personal/test-uid-2.ics", etag: '"sync-etag-2"' },
      ]);

      const result = await provider.syncEvents("/cal/personal/");

      expect(mockFetchCalendarObjects).toHaveBeenCalledWith({
        calendar: { url: "/cal/personal/" },
        timeRange: {
          start: expect.any(String),
          end: expect.any(String),
        },
      });

      expect(result.created).toHaveLength(2);
      expect(result.created[0]!.summary).toBe("Test Event");
      expect(result.created[0]!.etag).toBe('"sync-etag"');
      expect(result.created[1]!.summary).toBe("Second Event");
      expect(result.updated).toEqual([]);
      expect(result.deletedRemoteIds).toEqual([]);
      expect(result.newSyncToken).toBeNull();
      expect(result.newCtag).toBeNull();
    });

    it("uses the same malformed-object isolation as fetchEvents", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      mockFetchCalendarObjects.mockResolvedValue([
        { data: "broken calendar payload", url: "/cal/personal/broken.ics", etag: '"bad"' },
        { data: MOCK_ICAL_DATA_2, url: "/cal/personal/good.ics", etag: '"good"' },
      ]);

      const result = await provider.syncEvents("/cal/personal/");

      expect(result.created).toHaveLength(1);
      expect(result.created[0]?.uid).toBe("test-uid-2");
      expect(provider.lastReadDiagnostics).toEqual({ unreadableComponentCount: 0, unreadableObjectCount: 1 });
    });
  });

  describe("testConnection", () => {
    it("returns success with calendar count on successful connection", async () => {
      mockFetchCalendars.mockResolvedValue([
        { url: "/cal/personal/", displayName: "Personal" },
        { url: "/cal/work/", displayName: "Work" },
      ]);

      const result = await provider.testConnection();

      expect(result).toEqual({
        success: true,
        message: "Connected — found 2 calendars",
      });
    });

    it("returns singular form for one calendar", async () => {
      mockFetchCalendars.mockResolvedValue([
        { url: "/cal/personal/", displayName: "Personal" },
      ]);

      const result = await provider.testConnection();

      expect(result.message).toBe("Connected — found 1 calendar");
    });

    it("resets client and returns error message on failure", async () => {
      mockLogin.mockRejectedValueOnce(new Error("Authentication failed"));
      // Need a fresh provider so getClient() will attempt login again
      const freshProvider = new CalDAVProvider("acc-1");

      const result = await freshProvider.testConnection();

      expect(result).toEqual({
        success: false,
        message: "CALDAV: не удалось войти. Проверьте пароль или пароль приложения.",
      });

      // Verify client was reset by confirming a second call attempts login again
      mockLogin.mockResolvedValueOnce(undefined);
      mockFetchCalendars.mockResolvedValue([]);
      const retryResult = await freshProvider.testConnection();
      expect(retryResult.success).toBe(true);
      expect(mockLogin).toHaveBeenCalledTimes(2); // initial fail + retry after client reset
    });

    it("does not cache a DAV client when login fails", async () => {
      mockLogin.mockRejectedValueOnce(new Error("Login failed"));
      const freshProvider = new CalDAVProvider("acc-1");

      await expect(freshProvider.listCalendars()).rejects.toThrow("Login failed");

      mockLogin.mockResolvedValueOnce(undefined);
      mockFetchCalendars.mockResolvedValueOnce([{ url: "/cal/personal/", displayName: "Personal" }]);

      const calendars = await freshProvider.listCalendars();

      expect(calendars).toEqual([
        { remoteId: "/cal/personal/", displayName: "Personal", color: null, isPrimary: true },
      ]);
      expect(mockLogin).toHaveBeenCalledTimes(2);
    });

    it("handles non-Error thrown values gracefully", async () => {
      mockLogin.mockRejectedValueOnce("some string error");
      const freshProvider = new CalDAVProvider("acc-1");

      const result = await freshProvider.testConnection();

      expect(result).toEqual({
        success: false,
        message: "CALDAV: провайдер вернул ошибку. Повторите попытку.",
      });
    });

    it("uses the stored Yandex OAuth token instead of a CalDAV app password", async () => {
      vi.mocked(getAccount).mockResolvedValueOnce({
        id: "acc-yandex",
        email: "user@yandex.ru",
        display_name: null,
        avatar_url: null,
        access_token: "old-token",
        refresh_token: "refresh-token",
        token_expires_at: Math.floor(Date.now() / 1000) + 3600,
        history_id: null,
        last_sync_at: null,
        is_active: 1,
        created_at: 0,
        updated_at: 0,
        provider: "imap",
        imap_host: "imap.yandex.ru",
        imap_port: 993,
        imap_security: "ssl",
        smtp_host: "smtp.yandex.ru",
        smtp_port: 465,
        smtp_security: "ssl",
        auth_method: "oauth2",
        imap_password: null,
        oauth_provider: "yandex",
        oauth_client_id: "client-id",
        oauth_client_secret: null,
        imap_username: null,
        caldav_url: "https://caldav.yandex.ru/",
        caldav_username: "user@yandex.ru",
        caldav_password: null,
        caldav_principal_url: null,
        caldav_home_url: null,
        calendar_provider: "caldav",
        accept_invalid_certs: 0,
      });
      mockFetchCalendars.mockResolvedValue([{ url: "/cal/main/", displayName: "Main" }]);

      const result = await new CalDAVProvider("acc-yandex").testConnection();

      expect(result.success).toBe(true);
      expect(ensureFreshToken).toHaveBeenCalledWith(expect.objectContaining({ id: "acc-yandex" }));
      expect(mockLogin).toHaveBeenCalled();
    });
  });
});
