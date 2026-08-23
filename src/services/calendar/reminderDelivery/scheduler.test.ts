import { describe, expect, it, vi } from "vitest";
import { createCalendarReminder } from "../domain";
import type { ReminderDelivery, ReminderSourceEvent } from "./domain";
import { calendarNotificationPayload, ReminderScheduler } from "./scheduler";

const now = 2_000_000;
const source: ReminderSourceEvent = {
  accountId: "account-1", calendarId: "calendar-1", calendarName: "Work",
  eventResourceKey: "event-1", seriesUid: null, occurrenceKey: null,
  startTime: now + 600, endTime: now + 4200, timeKind: "timed-zoned",
  tzid: "UTC", wallStart: "1970-01-24T03:43:20",
  status: "confirmed", summary: "Private planning", canSeeEventDetails: true,
  reminders: { kind: "custom", reminders: [createCalendarReminder(10, "minutes")] },
};
const delivery: ReminderDelivery = {
  deliveryKey: "delivery-1", accountId: source.accountId, calendarId: source.calendarId,
  eventResourceKey: source.eventResourceKey, seriesUid: null,
  occurrenceKey: "single|event-1|2000600", reminderKey: "notification|before-start|600",
  scheduledAt: now, sourceFingerprint: "fingerprint", status: "delivering",
  parentDeliveryKey: null, deliveredAt: null, handledAt: null, leaseExpiresAt: now + 120,
  attemptCount: 1, failureCode: null, createdAt: now, updatedAt: now,
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    now: () => now,
    getSources: vi.fn().mockResolvedValue([source]),
    reconcile: vi.fn().mockResolvedValue({ created: 1, cancelled: 0 }),
    claimDue: vi.fn().mockResolvedValue([]),
    sourceForDelivery: vi.fn().mockResolvedValue(source),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    nextScheduledAt: vi.fn().mockResolvedValue(null),
    notify: vi.fn().mockResolvedValue({ status: "delivered", permission: "granted" }),
    permissionStatus: vi.fn(() => "granted"),
    requeuePermissionDenied: vi.fn().mockResolvedValue(undefined),
    emitDelivered: vi.fn(),
    emitStatus: vi.fn(),
    ...overrides,
  };
}

describe("ReminderScheduler", () => {
  it("single-flights concurrent startup/sync reconciliation", async () => {
    let release!: (value: ReminderSourceEvent[]) => void;
    const getSources = vi.fn(() => new Promise<ReminderSourceEvent[]>((resolve) => { release = resolve; }));
    const deps = dependencies({ getSources });
    const scheduler = new ReminderScheduler(deps as never);
    const first = scheduler.reconcileNow();
    const second = scheduler.reconcileNow();
    expect(getSources).toHaveBeenCalledTimes(1);
    release([source]);
    await Promise.all([first, second]);
    expect(deps.reconcile).toHaveBeenCalledTimes(1);
  });

  it("delivers a claimed reminder once and completes durable state", async () => {
    const plannedFingerprint = [...(await import("./domain")).activeReminderFingerprints([source])][0]!;
    const claimed = { ...delivery, sourceFingerprint: plannedFingerprint };
    const deps = dependencies({ claimDue: vi.fn().mockResolvedValue([claimed]) });
    await new ReminderScheduler(deps as never).reconcileNow();
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.complete).toHaveBeenCalledWith(claimed.deliveryKey, now);
    expect(deps.complete.mock.invocationCallOrder[0]).toBeLessThan(
      deps.notify.mock.invocationCallOrder[0]!,
    );
    expect(deps.emitDelivered).toHaveBeenCalledTimes(1);
  });

  it("keeps permission denial non-fatal and records a safe failure", async () => {
    const plannedFingerprint = [...(await import("./domain")).activeReminderFingerprints([source])][0]!;
    const deps = dependencies({
      claimDue: vi.fn().mockResolvedValue([{ ...delivery, sourceFingerprint: plannedFingerprint }]),
      notify: vi.fn().mockResolvedValue({ status: "permission-denied", permission: "denied" }),
    });
    await expect(new ReminderScheduler(deps as never).reconcileNow()).resolves.toBeUndefined();
    expect(deps.complete).toHaveBeenCalledWith(delivery.deliveryKey, now);
    expect(deps.fail).toHaveBeenCalledWith(delivery.deliveryKey, now, "permission-denied");
  });

  it("cancels a stale claimed delivery after event mutation", async () => {
    const deps = dependencies({ claimDue: vi.fn().mockResolvedValue([delivery]) });
    await new ReminderScheduler(deps as never).reconcileNow();
    expect(deps.cancel).toHaveBeenCalledWith(delivery.deliveryKey, now);
    expect(deps.notify).not.toHaveBeenCalled();
  });
});

describe("calendarNotificationPayload", () => {
  it("does not leak protected event details", () => {
    const payload = calendarNotificationPayload(delivery, {
      ...source,
      canSeeEventDetails: false,
      summary: "Secret title",
      calendarName: "Secret calendar",
    });
    expect(payload).toEqual(expect.objectContaining({ title: "Calendar reminder", body: "Busy event", privacyProtected: true }));
    expect(JSON.stringify(payload)).not.toMatch(/Secret|location|participant/i);
  });

  it("formats all-day dates in semantic UTC rather than host midnight", () => {
    const payload = calendarNotificationPayload(delivery, {
      ...source,
      timeKind: "all-day",
      tzid: null,
      wallStart: null,
      startTime: Date.UTC(2026, 2, 8) / 1000,
    });
    expect(payload.body).toMatch(/8/);
  });

  it("formats floating wall time without applying the host timezone", () => {
    const payload = calendarNotificationPayload(delivery, {
      ...source,
      timeKind: "floating",
      tzid: null,
      wallStart: "2026-03-08T09:00:00",
    });
    expect(payload.body).toMatch(/(?:09|9):00/);
  });
});
