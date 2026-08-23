import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/test/mocks";

const connectionMocks = vi.hoisted(() => ({ getDb: vi.fn(), withTransaction: vi.fn() }));
vi.mock("./connection", () => ({
  getDb: connectionMocks.getDb,
  withTransaction: connectionMocks.withTransaction,
}));

import {
  claimDueCalendarReminderDeliveries,
  dismissCalendarReminderDelivery,
  getCalendarReminderSources,
  reconcileCalendarReminderDeliveries,
  requeuePermissionDeniedCalendarReminders,
  snoozeCalendarReminderDelivery,
} from "./calendarReminderDeliveries";
import type { ReminderOccurrence } from "@/services/calendar/reminderDelivery/domain";

const db = createMockDb();
const occurrence: ReminderOccurrence = {
  deliveryKey: "delivery-1",
  accountId: "account-1",
  calendarId: "calendar-1",
  eventResourceKey: "event-1",
  seriesUid: "series-1",
  occurrenceKey: "occurrence-1",
  reminderKey: "notification|before-start|600",
  scheduledAt: 2_000_000,
  sourceFingerprint: "fingerprint-1",
};

const row = {
  delivery_key: occurrence.deliveryKey,
  account_id: occurrence.accountId,
  calendar_id: occurrence.calendarId,
  event_resource_key: occurrence.eventResourceKey,
  series_uid: occurrence.seriesUid,
  occurrence_key: occurrence.occurrenceKey,
  reminder_key: occurrence.reminderKey,
  scheduled_at: occurrence.scheduledAt,
  source_fingerprint: occurrence.sourceFingerprint,
  status: "scheduled",
  parent_delivery_key: null,
  delivered_at: null,
  handled_at: null,
  lease_expires_at: null,
  attempt_count: 0,
  failure_code: null,
  created_at: 1,
  updated_at: 1,
} as const;

describe("calendar reminder delivery persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionMocks.getDb.mockResolvedValue(db);
    connectionMocks.withTransaction.mockImplementation(async (fn) => fn(db));
    db.execute.mockResolvedValue({ rowsAffected: 1 });
    db.select.mockResolvedValue([]);
  });

  it("uses INSERT OR IGNORE for durable delivery-key dedupe", async () => {
    await reconcileCalendarReminderDeliveries([occurrence], new Set([occurrence.sourceFingerprint]), {
      catchUpStart: 1_900_000,
      scheduleEnd: 2_100_000,
    });
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT OR IGNORE INTO calendar_reminder_deliveries");
    expect(params[0]).toBe(occurrence.deliveryKey);
  });

  it("loads reminder sources in one joined batch without N+1 queries", async () => {
    db.select.mockResolvedValueOnce([{
      id: "row-1", account_id: "account-1", google_event_id: "event-1",
      summary: "Visible", description: null, location: null, start_time: 2_000_000,
      end_time: 2_003_600, is_all_day: 0, status: "confirmed", organizer_email: null,
      attendees_json: null, html_link: null, updated_at: 1, calendar_id: "calendar-1",
      remote_event_id: "event-1", etag: null, ical_data: null, uid: "uid-1",
      time_kind: "timed-zoned", tzid: "UTC", wall_start: "1970-01-24T03:33:20",
      wall_end: "1970-01-24T04:33:20", end_date_exclusive: null, series_uid: "uid-1",
      occurrence_key: null, is_recurrence_master: 0, transp: "opaque", sequence: 0,
      origin: "remote", projection_key: null, projection_status: null,
      reminders_json: '{"version":1,"policy":{"kind":"custom","reminders":[{"method":"notification","trigger":{"kind":"before-start","duration":{"seconds":600}}}]}}',
      calendar_name: "Work", access_json: null,
    }]);
    const sources = await getCalendarReminderSources(1_000_000, 3_000_000);
    expect(sources).toHaveLength(1);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.select.mock.calls[0]?.[0]).toContain("JOIN calendars");
  });

  it("cancels pending rows whose source fingerprint disappeared after mutation/delete", async () => {
    db.select.mockResolvedValueOnce([row]);
    const result = await reconcileCalendarReminderDeliveries([], new Set(), {
      catchUpStart: 1_900_000,
      scheduleEnd: 2_100_000,
    });
    expect(result.cancelled).toBe(1);
    expect(db.execute.mock.calls.at(-1)?.[0]).toContain("status = 'cancelled'");
  });

  it("atomically claims a due row and increments its attempt count", async () => {
    db.select.mockResolvedValueOnce([row]);
    const claimed = await claimDueCalendarReminderDeliveries({
      now: 2_000_000,
      catchUpStart: 1_990_000,
      leaseSeconds: 120,
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ status: "delivering", attemptCount: 1, leaseExpiresAt: 2_000_120 });
    expect(db.execute.mock.calls.some(([sql]) => String(sql).includes("attempt_count = attempt_count + 1"))).toBe(true);
    expect(db.execute.mock.calls[0]?.[0]).toContain("scheduled_at < $2");
  });

  it("snooze marks the delivered parent and inserts a linked scheduled child", async () => {
    const deliveredRow = { ...row, status: "delivered", delivered_at: 1_999_999 };
    const childRow = {
      ...row,
      delivery_key: "delivery-1|snooze|2000600",
      scheduled_at: 2_000_600,
      parent_delivery_key: "delivery-1",
    };
    db.select.mockResolvedValueOnce([deliveredRow]).mockResolvedValueOnce([childRow]);
    const child = await snoozeCalendarReminderDelivery("delivery-1", 2_000_600, 2_000_000);
    expect(child).toMatchObject({ parentDeliveryKey: "delivery-1", scheduledAt: 2_000_600 });
    expect(db.execute.mock.calls[0]?.[0]).toContain("status = 'snoozed'");
    expect(db.execute.mock.calls[1]?.[0]).toContain("INSERT OR IGNORE");
  });

  it("dismiss handles only the current delivered reminder", async () => {
    await dismissCalendarReminderDelivery("delivery-1", 2_000_000);
    expect(db.execute).toHaveBeenCalledWith(expect.stringContaining("status = 'dismissed'"), ["delivery-1", 2_000_000]);
    expect(db.execute.mock.calls[0]?.[0]).toContain("WHERE delivery_key = $1 AND status = 'delivered'");
  });

  it("requeues permission-denied catch-up only after the permission layer allows it", async () => {
    await requeuePermissionDeniedCalendarReminders(1_990_000);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("failure_code = 'permission-denied'"),
      [1_990_000],
    );
  });
});
