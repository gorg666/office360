import { describe, expect, it } from "vitest";
import { createCalendarReminder } from "../domain";
import {
  activeReminderFingerprints,
  canonicalOccurrenceIdentity,
  planReminderOccurrences,
  reminderWindow,
  type ReminderSourceEvent,
} from "./domain";

function source(overrides: Partial<ReminderSourceEvent> = {}): ReminderSourceEvent {
  return {
    accountId: "account-1",
    calendarId: "calendar-1",
    calendarName: "Work",
    eventResourceKey: "event-1",
    seriesUid: null,
    occurrenceKey: null,
    startTime: 2_000_000,
    endTime: 2_003_600,
    timeKind: "timed-zoned",
    tzid: "UTC",
    wallStart: "1970-01-24T03:33:20",
    status: "confirmed",
    summary: "Standup",
    canSeeEventDetails: true,
    reminders: { kind: "custom", reminders: [createCalendarReminder(10, "minutes")] },
    ...overrides,
  };
}

describe("Calendar reminder occurrence planning", () => {
  it("creates a deterministic delivery once for a timed event", () => {
    const event = source();
    const window = { catchUpStart: 1_000_000, scheduleEnd: 3_000_000 };
    const first = planReminderOccurrences([event], window);
    const second = planReminderOccurrences([event, event], window);
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(first[0]).toMatchObject({ scheduledAt: event.startTime - 600 });
  });

  it("keeps multiple reminders independent and ignores provider email delivery", () => {
    const planned = planReminderOccurrences([source({
      reminders: {
        kind: "custom",
        reminders: [
          createCalendarReminder(60, "minutes"),
          createCalendarReminder(15, "minutes"),
          createCalendarReminder(5, "minutes"),
          createCalendarReminder(10, "minutes", "email"),
        ],
      },
    })], { catchUpStart: 1_000_000, scheduleEnd: 3_000_000 });
    expect(planned.map((item) => item.scheduledAt)).toEqual([
      2_000_000 - 3600,
      2_000_000 - 900,
      2_000_000 - 300,
    ]);
    expect(new Set(planned.map((item) => item.deliveryKey)).size).toBe(3);
  });

  it("preserves recurrence occurrence identity for weekly, override, and EXDATE-expanded inputs", () => {
    const weekly = [0, 7, 14].map((days) => source({
      eventResourceKey: `series.ics::${days}`,
      seriesUid: "weekly-uid",
      occurrenceKey: `weekly-uid|Z|America%2FNew_York|202603${String(1 + days).padStart(2, "0")}T090000`,
      startTime: 2_000_000 + days * 86400,
    }));
    // The recurrence engine has already removed EXDATE and projected overrides.
    const expanded = [weekly[0]!, weekly[2]!];
    const planned = planReminderOccurrences(expanded, { catchUpStart: 1_000_000, scheduleEnd: 4_000_000 });
    expect(planned).toHaveLength(2);
    expect(planned.map((item) => item.occurrenceKey)).toEqual(expanded.map((item) => item.occurrenceKey));
  });

  it.each(["timed-zoned", "floating", "all-day"] as const)("plans resolved %s events", (timeKind) => {
    expect(planReminderOccurrences([source({ timeKind })], { catchUpStart: 1_000_000, scheduleEnd: 3_000_000 })).toHaveLength(1);
  });

  it("never falls back to host time for unresolved legacy rows and skips cancelled events", () => {
    const window = { catchUpStart: 1_000_000, scheduleEnd: 3_000_000 };
    expect(planReminderOccurrences([source({ timeKind: null })], window)).toEqual([]);
    expect(planReminderOccurrences([source({ status: "cancelled" })], window)).toEqual([]);
  });

  it("uses account and calendar in identity and keeps duplicate provider ids isolated", () => {
    const planned = planReminderOccurrences([
      source(),
      source({ accountId: "account-2" }),
      source({ calendarId: "calendar-2" }),
    ], { catchUpStart: 1_000_000, scheduleEnd: 3_000_000 });
    expect(new Set(planned.map((item) => item.deliveryKey)).size).toBe(3);
  });

  it("bounds catch-up and scheduling windows", () => {
    const now = 2_000_000;
    const window = reminderWindow(now);
    expect(planReminderOccurrences([source({ startTime: window.catchUpStart - 1 + 600 })], window)).toEqual([]);
    expect(planReminderOccurrences([source({ startTime: window.scheduleEnd + 601 })], window)).toEqual([]);
  });

  it("changes source fingerprint after a mutation but not after a title-only edit", () => {
    const base = source();
    const original = activeReminderFingerprints([base]);
    expect(activeReminderFingerprints([source({ summary: "Renamed" })])).toEqual(original);
    expect(activeReminderFingerprints([source({ startTime: base.startTime + 900 })])).not.toEqual(original);
  });

  it("derives a standalone identity without relying on attendee order or title", () => {
    expect(canonicalOccurrenceIdentity(source())).toBe("single|event-1|2000000");
  });
});
