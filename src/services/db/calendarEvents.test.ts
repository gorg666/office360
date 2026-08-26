import { describe, it, expect, beforeEach, vi } from "vitest";

const connectionMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  selectFirstBy: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("@/services/db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/db/connection")>();
  return {
    ...actual,
    getDb: connectionMocks.getDb,
    selectFirstBy: connectionMocks.selectFirstBy,
    withTransaction: connectionMocks.withTransaction,
  };
});

import { getDb, selectFirstBy } from "@/services/db/connection";
import {
  upsertCalendarEvent,
  getCalendarEventsInRange,
  getCalendarEventsInRangeMulti,
  deleteCalendarEventsInRange,
  deleteEventsForCalendar,
  getEventByRemoteId,
  deleteEventByRemoteId,
  deleteCalendarEvent,
  normalizeCalendarEventRow,
  clearCalendarEventNormalizationCache,
  reconcileCalendarEventsRange,
  calendarEventDataToUpsert,
  applyCalendarSyncBatch,
  type DbCalendarEvent,
} from "./calendarEvents";
import { createMockDb } from "@/test/mocks";
import { parseVEvent } from "@/services/calendar/icalHelper";

const mockDb = createMockDb();

const makeEvent = (overrides: Partial<DbCalendarEvent> = {}): DbCalendarEvent => ({
  id: "evt-1",
  account_id: "acc-1",
  google_event_id: "gev-1",
  summary: "Team standup",
  description: "Daily sync",
  location: "Room A",
  start_time: 1000,
  end_time: 2000,
  is_all_day: 0,
  status: "confirmed",
  organizer_email: "org@example.com",
  attendees_json: null,
  html_link: "https://calendar.google.com/event/1",
  updated_at: 999,
  calendar_id: null,
  remote_event_id: null,
  etag: null,
  ical_data: null,
  uid: null,
  time_kind: "timed-zoned",
  tzid: "UTC",
  wall_start: "1970-01-01T00:16:40",
  wall_end: "1970-01-01T00:33:20",
  end_date_exclusive: null,
  series_uid: null,
  occurrence_key: null,
  is_recurrence_master: 0,
  transp: null,
  sequence: 0,
  origin: "remote",
  projection_key: null,
  projection_status: null,
  reminders_json: null,
  ...overrides,
});

describe("calendarEvents service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCalendarEventNormalizationCache();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
    connectionMocks.withTransaction.mockImplementation(async (fn) => fn(mockDb));
  });

  describe("upsertCalendarEvent", () => {
    it("inserts event with all fields including CalDAV fields", async () => {
      await upsertCalendarEvent({
        accountId: "acc-1",
        googleEventId: "gev-1",
        summary: "Team standup",
        description: "Daily sync",
        location: "Room A",
        startTime: 1000,
        endTime: 2000,
        isAllDay: false,
        status: "confirmed",
        organizerEmail: "org@example.com",
        attendeesJson: '[{"email":"a@b.com"}]',
        htmlLink: "https://calendar.google.com/event/1",
        calendarId: "cal-1",
        remoteEventId: "remote-1",
        etag: '"etag-abc"',
        icalData: "BEGIN:VEVENT\nEND:VEVENT",
        uid: "uid-123@example.com",
      });

      expect(mockDb.execute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDb.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("INSERT INTO calendar_events");
      expect(sql).toContain("ON CONFLICT(account_id, google_event_id) DO UPDATE");
      // params[0] is the generated UUID id, skip it
      expect(params[1]).toBe("acc-1");
      expect(params[2]).toBe("gev-1");
      expect(params[3]).toBe("Team standup");
      expect(params[4]).toBe("Daily sync");
      expect(params[5]).toBe("Room A");
      expect(params[6]).toBe(1000);
      expect(params[7]).toBe(2000);
      expect(params[8]).toBe(0); // isAllDay false -> 0
      expect(params[9]).toBe("confirmed");
      expect(params[10]).toBe("org@example.com");
      expect(params[11]).toBe('[{"email":"a@b.com"}]');
      expect(params[12]).toBe("https://calendar.google.com/event/1");
      expect(params[13]).toBe("cal-1");
      expect(params[14]).toBe("remote-1");
      expect(params[15]).toBe('"etag-abc"');
      expect(params[16]).toBe("BEGIN:VEVENT\nEND:VEVENT");
      expect(params[17]).toBe("uid-123@example.com");
    });

    it("converts isAllDay true to 1", async () => {
      await upsertCalendarEvent({
        accountId: "acc-1",
        googleEventId: "gev-2",
        summary: null,
        description: null,
        location: null,
        startTime: 1000,
        endTime: 2000,
        isAllDay: true,
        status: "confirmed",
        organizerEmail: null,
        attendeesJson: null,
        htmlLink: null,
      });

      const [, params] = mockDb.execute.mock.calls[0] as [string, unknown[]];
      expect(params[8]).toBe(1);
    });

    it("defaults optional CalDAV fields to null", async () => {
      await upsertCalendarEvent({
        accountId: "acc-1",
        googleEventId: "gev-3",
        summary: null,
        description: null,
        location: null,
        startTime: 1000,
        endTime: 2000,
        isAllDay: false,
        status: "confirmed",
        organizerEmail: null,
        attendeesJson: null,
        htmlLink: null,
      });

      const [, params] = mockDb.execute.mock.calls[0] as [string, unknown[]];
      expect(params[13]).toBeNull(); // calendarId
      expect(params[14]).toBeNull(); // remoteEventId
      expect(params[15]).toBeNull(); // etag
      expect(params[16]).toBeNull(); // icalData
      expect(params[17]).toBeNull(); // uid
    });

    it("stores new semantic fields on write", async () => {
      await upsertCalendarEvent({
        accountId: "acc-1", googleEventId: "semantic-1", summary: "Zoned",
        description: null, location: null, startTime: 1773558000, endTime: 1773561600,
        isAllDay: false, status: "confirmed", organizerEmail: null,
        attendeesJson: null, htmlLink: null, uid: "series-1",
        time: {
          kind: "timed-zoned",
          start: { wall: { year: 2026, month: 3, day: 15, hour: 10, minute: 0, second: 0 }, tzid: "Europe/Moscow", instant: 1773558000 },
          end: { wall: { year: 2026, month: 3, day: 15, hour: 11, minute: 0, second: 0 }, tzid: "Europe/Moscow", instant: 1773561600 },
        },
        seriesUid: "series-1", occurrenceKey: "series-1::occurrence", isRecurrenceMaster: true,
        transparency: "transparent", sequence: 7,
      });

      const [, params] = mockDb.execute.mock.calls[0] as [string, unknown[]];
      expect(params.slice(18, 28)).toEqual([
        "timed-zoned", "Europe/Moscow", "2026-03-15T10:00:00", "2026-03-15T11:00:00",
        null, "series-1", "series-1::occurrence", 1, "transparent", 7,
      ]);
    });

    it("updates existing event on conflict (same account_id + google_event_id)", async () => {
      await upsertCalendarEvent({
        accountId: "acc-1",
        googleEventId: "gev-1",
        summary: "Updated standup",
        description: null,
        location: null,
        startTime: 3000,
        endTime: 4000,
        isAllDay: false,
        status: "tentative",
        organizerEmail: null,
        attendeesJson: null,
        htmlLink: null,
        calendarId: "cal-2",
        remoteEventId: "remote-2",
        etag: '"etag-new"',
        icalData: "BEGIN:VEVENT\nUPDATED\nEND:VEVENT",
        uid: "uid-456@example.com",
      });

      const [sql, params] = mockDb.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("ON CONFLICT(account_id, google_event_id) DO UPDATE SET");
      expect(sql).toContain("calendar_id = $14");
      expect(sql).toContain("remote_event_id = $15");
      expect(sql).toContain("etag = $16");
      expect(sql).toContain("ical_data = $17");
      expect(sql).toContain("uid = $18");
      expect(sql).toContain("reminders_json = $32");
      expect(sql).toContain("updated_at = unixepoch()");
      expect(params[3]).toBe("Updated standup");
      expect(params[6]).toBe(3000);
      expect(params[7]).toBe(4000);
      expect(params[9]).toBe("tentative");
    });
  });

  describe("getCalendarEventsInRange", () => {
    it("returns events within the given time range", async () => {
      const events = [makeEvent(), makeEvent({ id: "evt-2", start_time: 1500 })];
      mockDb.select.mockResolvedValueOnce(events);

      const result = await getCalendarEventsInRange("acc-1", 500, 2500);

      expect(result).toEqual(events);
      expect(mockDb.select).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDb.select.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("WHERE account_id = $1 AND start_time < $3 AND end_time > $2");
      expect(sql).toContain("ORDER BY start_time ASC");
      expect(params).toEqual(["acc-1", 500, 2500]);
    });

    it("returns empty array when no events match", async () => {
      mockDb.select.mockResolvedValueOnce([]);

      const result = await getCalendarEventsInRange("acc-1", 5000, 6000);

      expect(result).toEqual([]);
    });
  });

  describe("legacy semantic projection", () => {
    it("derives semantic fields lazily without writing the legacy row", () => {
      const legacy = makeEvent({
        time_kind: null, tzid: null, wall_start: null, wall_end: null,
        end_date_exclusive: null, series_uid: null, occurrence_key: null,
        ical_data: [
          "BEGIN:VEVENT", "UID:legacy-series",
          "DTSTART;TZID=Europe/Moscow:20260315T100000",
          "DTEND;TZID=Europe/Moscow:20260315T110000", "RRULE:FREQ=WEEKLY;COUNT=2", "END:VEVENT",
        ].join("\r\n"),
      });

      const result = normalizeCalendarEventRow(legacy);
      expect(result).toMatchObject({
        time_kind: "timed-zoned", tzid: "Europe/Moscow",
        wall_start: "2026-03-15T10:00:00", series_uid: "legacy-series",
        is_recurrence_master: 1,
      });
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it("memoizes a legacy semantic projection for repeated reads", () => {
      const legacy = makeEvent({
        time_kind: null,
        ical_data: [
          "BEGIN:VEVENT", "UID:legacy-cache", "DTSTART:20260315T100000Z",
          "DTEND:20260315T110000Z", "END:VEVENT",
        ].join("\r\n"),
      });
      const first = normalizeCalendarEventRow(legacy);
      const second = normalizeCalendarEventRow({ ...legacy });
      expect(second).toBe(first);
    });

    it("lazily derives CalDAV reminders without writing the legacy row", () => {
      const legacy = makeEvent({
        reminders_json: null,
        ical_data: [
          "BEGIN:VEVENT", "UID:legacy-reminder", "DTSTART:20260315T100000Z", "DTEND:20260315T110000Z",
          "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Reminder", "END:VALARM", "END:VEVENT",
        ].join("\r\n"),
      });

      const result = normalizeCalendarEventRow(legacy);
      expect(JSON.parse(result.reminders_json!)).toEqual({
        version: 1,
        policy: { kind: "custom", reminders: [{ method: "notification", trigger: { kind: "before-start", duration: { seconds: 900 } } }] },
      });
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it("keeps Google legacy reminder state unknown until normal refresh", () => {
      const legacy = makeEvent({ reminders_json: null, ical_data: null });
      expect(normalizeCalendarEventRow(legacy).reminders_json).toBeNull();
      expect(mockDb.execute).not.toHaveBeenCalled();
    });
  });

  it("persists the canonical reminder envelope on a normal provider sync projection", () => {
    const event = parseVEvent([
      "BEGIN:VEVENT", "UID:sync-reminder", "DTSTART:20260315T100000Z", "DTEND:20260315T110000Z",
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT10M", "DESCRIPTION:Reminder", "END:VALARM", "END:VEVENT",
    ].join("\r\n"));
    const projected = calendarEventDataToUpsert("acc-1", "cal-1", event);
    expect(JSON.parse(projected.remindersJson!)).toEqual({
      version: 1,
      policy: { kind: "custom", reminders: [{ method: "notification", trigger: { kind: "before-start", duration: { seconds: 600 } } }] },
    });
  });

  describe("authoritative reconciliation", () => {
    const providerEvent = (id: string) => ({
      remoteEventId: id,
      uid: `uid-${id}`,
      etag: null,
      summary: id,
      description: null,
      location: null,
      startTime: 1000,
      endTime: 2000,
      isAllDay: false,
      status: "confirmed",
      organizerEmail: null,
      attendeesJson: null,
      htmlLink: null,
      icalData: null,
      time: {
        kind: "timed-zoned" as const,
        start: { wall: { year: 1970, month: 1, day: 1, hour: 0, minute: 16, second: 40 }, tzid: "UTC", instant: 1000 },
        end: { wall: { year: 1970, month: 1, day: 1, hour: 0, minute: 33, second: 20 }, tzid: "UTC", instant: 2000 },
      },
      seriesUid: `uid-${id}`,
      occurrenceKey: null,
      isRecurrenceMaster: false,
      transparency: null,
      sequence: 0,
      participants: [],
      reminders: { kind: "none" as const },
    });

    it("upserts current A,C,D then removes only missing remote identities", async () => {
      await reconcileCalendarEventsRange({
        accountId: "acc-1", calendarId: "cal-1", rangeStart: 500, rangeEnd: 2500,
        events: [providerEvent("A"), providerEvent("C"), providerEvent("D")],
        diagnostics: { unreadableComponentCount: 0, unreadableObjectCount: 0 },
      });
      const deleteCall = mockDb.execute.mock.calls.find(([sql]) => String(sql).includes("google_event_id NOT IN"));
      expect(deleteCall).toBeDefined();
      expect(deleteCall?.[1]).toEqual(["acc-1", "cal-1", 500, 2500, "A", "C", "D"]);
      expect(mockDb.execute.mock.calls.at(-1)?.[0]).toContain("calendar_sync_coverage");
    });

    it("does not delete missing cache rows for a degraded response", async () => {
      await reconcileCalendarEventsRange({
        accountId: "acc-1", calendarId: "cal-1", rangeStart: 500, rangeEnd: 2500,
        events: [providerEvent("A")],
        diagnostics: { unreadableComponentCount: 1, unreadableObjectCount: 0 },
      });
      expect(mockDb.execute.mock.calls.some(([sql]) => String(sql).includes("google_event_id NOT IN"))).toBe(false);
      const coverageCall = mockDb.execute.mock.calls.at(-1) as [string, unknown[]];
      expect(coverageCall[1][5]).toBe("partial");
    });

    it("removes a matching local RSVP projection after remote confirmation", async () => {
      await reconcileCalendarEventsRange({
        accountId: "acc-1", calendarId: "cal-1", rangeStart: 500, rangeEnd: 2500,
        events: [providerEvent("A")],
        diagnostics: { unreadableComponentCount: 0, unreadableObjectCount: 0 },
      });
      const projectionDelete = mockDb.execute.mock.calls.find(([sql]) => String(sql).includes("origin = 'local_projection'"));
      expect(projectionDelete?.[1]).toEqual(["acc-1", "uid-A", 1000]);
    });
  });

  describe("getCalendarEventsInRangeMulti", () => {
    it("filters by calendar IDs and explicit local projections", async () => {
      const events = [
        makeEvent({ calendar_id: "cal-1" }),
        makeEvent({ id: "evt-2", calendar_id: null, origin: "local_projection", projection_key: "invite:uid:", projection_status: "pending" }),
      ];
      mockDb.select.mockResolvedValueOnce(events);

      const result = await getCalendarEventsInRangeMulti("acc-1", ["cal-1", "cal-2"], 500, 2500);

      expect(result).toEqual(events);
      expect(mockDb.select).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDb.select.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("calendar_id IN ($4, $5)");
      expect(sql).toContain("origin = 'local_projection'");
      expect(sql).toContain("google_event_id LIKE 'invite:%'");
      expect(params).toEqual(["acc-1", 500, 2500, "cal-1", "cal-2"]);
    });

    it("returns only local projections when no remote calendar is visible", async () => {
      const events = [makeEvent({ origin: "local_projection", projection_key: "invite:uid:", projection_status: "pending" })];
      mockDb.select.mockResolvedValueOnce(events);

      const result = await getCalendarEventsInRangeMulti("acc-1", [], 500, 2500);

      expect(result).toEqual(events);
      expect(mockDb.select).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDb.select.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toContain("calendar_id IN");
      expect(sql).toContain("WHERE account_id = $1 AND start_time < $3 AND end_time > $2");
      expect(sql).toContain("origin = 'local_projection'");
      expect(params).toEqual(["acc-1", 500, 2500]);
    });
  });

  describe("deleteEventsForCalendar", () => {
    it("removes all events for a given calendar_id", async () => {
      await deleteEventsForCalendar("cal-1");

      expect(mockDb.execute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDb.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toBe("DELETE FROM calendar_events WHERE calendar_id = $1");
      expect(params).toEqual(["cal-1"]);
    });
  });

  describe("deleteCalendarEventsInRange", () => {
    it("removes only cached instances overlapping the refreshed range", async () => {
      await deleteCalendarEventsInRange("acc-1", "cal-1", 500, 2500);

      const [sql, params] = mockDb.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("account_id = $1 AND calendar_id = $2");
      expect(sql).toContain("start_time < $4 AND end_time > $3");
      expect(params).toEqual(["acc-1", "cal-1", 500, 2500]);
    });
  });

  describe("getEventByRemoteId", () => {
    it("returns event matching calendar_id and remote_event_id", async () => {
      const event = makeEvent({ calendar_id: "cal-1", remote_event_id: "remote-1" });
      vi.mocked(selectFirstBy).mockResolvedValueOnce(event);

      const result = await getEventByRemoteId("cal-1", "remote-1");

      expect(result).toEqual(event);
      expect(selectFirstBy).toHaveBeenCalledTimes(1);
      const [sql, params] = vi.mocked(selectFirstBy).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("WHERE calendar_id = $1 AND remote_event_id = $2");
      expect(params).toEqual(["cal-1", "remote-1"]);
    });

    it("returns null when no event matches", async () => {
      vi.mocked(selectFirstBy).mockResolvedValueOnce(null);

      const result = await getEventByRemoteId("cal-1", "nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("deleteEventByRemoteId", () => {
    it("removes event matching calendar_id and remote_event_id", async () => {
      await deleteEventByRemoteId("cal-1", "remote-1");

      expect(mockDb.execute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDb.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toBe("DELETE FROM calendar_events WHERE calendar_id = $1 AND remote_event_id = $2");
      expect(params).toEqual(["cal-1", "remote-1"]);
    });
  });

  describe("deleteCalendarEvent", () => {
    it("removes event by id", async () => {
      await deleteCalendarEvent("evt-1");

      expect(mockDb.execute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDb.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toBe("DELETE FROM calendar_events WHERE id = $1");
      expect(params).toEqual(["evt-1"]);
    });
  });

  describe("applyCalendarSyncBatch", () => {
    it("applies tombstones before committing the new opaque cursor", async () => {
      await applyCalendarSyncBatch({
        accountId: "acc-1",
        calendarId: "cal-1",
        result: {
          created: [], updated: [], deletedRemoteIds: ["gone.ics"],
          newSyncToken: "cursor-2", newCtag: null, complete: true,
        },
      });

      expect(mockDb.execute).toHaveBeenCalledTimes(2);
      expect(mockDb.execute.mock.calls[0]?.[0]).toContain("DELETE FROM calendar_events");
      expect(mockDb.execute.mock.calls[1]?.[0]).toContain("UPDATE calendars SET sync_token");
    });

    it("never advances the cursor when local batch application fails", async () => {
      mockDb.execute.mockRejectedValueOnce(new Error("disk full"));
      await expect(applyCalendarSyncBatch({
        accountId: "acc-1",
        calendarId: "cal-1",
        result: {
          created: [], updated: [], deletedRemoteIds: ["gone.ics"],
          newSyncToken: "cursor-2", newCtag: null, complete: true,
        },
      })).rejects.toThrow("disk full");

      expect(mockDb.execute).toHaveBeenCalledTimes(1);
      expect(String(mockDb.execute.mock.calls[0]?.[0])).not.toContain("UPDATE calendars SET sync_token");
    });

    it("replaces all cached occurrences for a changed CalDAV resource before cursor commit", async () => {
      await applyCalendarSyncBatch({
        accountId: "acc-1",
        calendarId: "cal-1",
        result: {
          created: [], updated: [], deletedRemoteIds: [], replacedRemoteIds: ["series.ics"],
          newSyncToken: "cursor-2", newCtag: null, complete: true,
        },
      });

      expect(mockDb.execute.mock.calls[0]?.[1]).toEqual(["cal-1", "series.ics"]);
      expect(mockDb.execute.mock.calls.at(-1)?.[0]).toContain("UPDATE calendars SET sync_token");
    });

    it("removes stale legacy remote rows during an authoritative collection recovery", async () => {
      await applyCalendarSyncBatch({
        accountId: "acc-1",
        calendarId: "cal-1",
        result: {
          created: [], updated: [], deletedRemoteIds: [],
          newSyncToken: "cursor-2", newCtag: null, complete: true,
          authoritativeSnapshot: true,
        },
      });

      expect(mockDb.execute.mock.calls[0]?.[0]).toContain("origin IS NULL OR origin = 'remote'");
      expect(mockDb.execute.mock.calls.at(-1)?.[0]).toContain("UPDATE calendars SET sync_token");
    });
  });
});
