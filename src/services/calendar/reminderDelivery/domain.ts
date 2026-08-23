import { normalizeCalendarReminderPolicy, type CalendarReminderPolicy } from "../domain";

export type ReminderDeliveryStatus =
  | "scheduled"
  | "delivering"
  | "delivered"
  | "dismissed"
  | "snoozed"
  | "cancelled"
  | "failed";

export interface ReminderSourceEvent {
  accountId: string;
  calendarId: string;
  calendarName: string | null;
  eventResourceKey: string;
  seriesUid: string | null;
  occurrenceKey: string | null;
  startTime: number;
  endTime: number;
  timeKind: "timed-zoned" | "floating" | "all-day" | null;
  tzid: string | null;
  wallStart: string | null;
  status: string;
  summary: string | null;
  canSeeEventDetails: boolean;
  reminders: CalendarReminderPolicy;
}

/** Concrete reminder firing. It intentionally contains no persisted event details. */
export interface ReminderOccurrence {
  deliveryKey: string;
  accountId: string;
  calendarId: string;
  eventResourceKey: string;
  seriesUid: string | null;
  occurrenceKey: string;
  reminderKey: string;
  scheduledAt: number;
  sourceFingerprint: string;
}

export interface ReminderDelivery extends ReminderOccurrence {
  status: ReminderDeliveryStatus;
  parentDeliveryKey: string | null;
  deliveredAt: number | null;
  handledAt: number | null;
  leaseExpiresAt: number | null;
  attemptCount: number;
  failureCode: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ReminderDeliveryWindow {
  catchUpStart: number;
  scheduleEnd: number;
}

export const CALENDAR_REMINDER_CATCH_UP_SECONDS = 6 * 60 * 60;
export const CALENDAR_REMINDER_SCHEDULE_HORIZON_SECONDS = 30 * 24 * 60 * 60;
export const CALENDAR_REMINDER_LEASE_SECONDS = 2 * 60;
export const CALENDAR_REMINDER_SNOOZE_PRESETS_MINUTES = [5, 10, 30, 60] as const;

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function canonicalOccurrenceIdentity(source: ReminderSourceEvent): string {
  return source.occurrenceKey
    ?? `single|${segment(source.eventResourceKey)}|${source.startTime}`;
}

export function canonicalReminderIdentity(reminder: { id?: string; method: string; trigger: { duration: { seconds: number } } }): string {
  return reminder.id
    ? `id|${segment(reminder.id)}`
    : `${segment(reminder.method)}|before-start|${reminder.trigger.duration.seconds}`;
}

export function reminderSourceFingerprint(
  source: ReminderSourceEvent,
  occurrenceKey: string,
  reminderKey: string,
): string {
  return [
    "v1",
    segment(source.accountId),
    segment(source.calendarId),
    segment(source.eventResourceKey),
    segment(occurrenceKey),
    segment(reminderKey),
    String(source.startTime),
    String(source.endTime),
    source.status.toLowerCase(),
    source.timeKind ?? "unknown-time",
    source.tzid ?? "",
    source.wallStart ?? "",
  ].join("|");
}

export function reminderDeliveryKey(input: Omit<ReminderOccurrence, "deliveryKey" | "sourceFingerprint">): string {
  return [
    "calendar-reminder-v1",
    segment(input.accountId),
    segment(input.calendarId),
    segment(input.eventResourceKey),
    segment(input.occurrenceKey),
    segment(input.reminderKey),
    String(input.scheduledAt),
  ].join("|");
}

export function snoozedReminderDeliveryKey(parentDeliveryKey: string, scheduledAt: number): string {
  return `${parentDeliveryKey}|snooze|${scheduledAt}`;
}

export function planReminderOccurrences(
  sources: readonly ReminderSourceEvent[],
  window: ReminderDeliveryWindow,
): ReminderOccurrence[] {
  const planned = new Map<string, ReminderOccurrence>();

  for (const source of sources) {
    if (!source.calendarId || !source.eventResourceKey) continue;
    if (source.status.toLowerCase() === "cancelled") continue;
    // A semantic time kind proves startTime was resolved by the Calendar time
    // domain. Never fall back to host-local interpretation for legacy rows.
    if (!source.timeKind) continue;

    const policy = normalizeCalendarReminderPolicy(source.reminders);
    if (policy.kind !== "custom") continue;
    const occurrenceKey = canonicalOccurrenceIdentity(source);

    for (const reminder of policy.reminders) {
      if (reminder.method !== "notification") continue;
      const scheduledAt = source.startTime - reminder.trigger.duration.seconds;
      if (scheduledAt < window.catchUpStart || scheduledAt > window.scheduleEnd) continue;
      const reminderKey = canonicalReminderIdentity(reminder);
      const base = {
        accountId: source.accountId,
        calendarId: source.calendarId,
        eventResourceKey: source.eventResourceKey,
        seriesUid: source.seriesUid,
        occurrenceKey,
        reminderKey,
        scheduledAt,
      };
      const deliveryKey = reminderDeliveryKey(base);
      planned.set(deliveryKey, {
        ...base,
        deliveryKey,
        sourceFingerprint: reminderSourceFingerprint(source, occurrenceKey, reminderKey),
      });
    }
  }

  return [...planned.values()].sort((left, right) =>
    left.scheduledAt - right.scheduledAt || left.deliveryKey.localeCompare(right.deliveryKey),
  );
}

export function activeReminderFingerprints(sources: readonly ReminderSourceEvent[]): Set<string> {
  const fingerprints = new Set<string>();
  for (const source of sources) {
    if (!source.timeKind || source.status.toLowerCase() === "cancelled") continue;
    const policy = normalizeCalendarReminderPolicy(source.reminders);
    if (policy.kind !== "custom") continue;
    const occurrenceKey = canonicalOccurrenceIdentity(source);
    for (const reminder of policy.reminders) {
      if (reminder.method !== "notification") continue;
      const reminderKey = canonicalReminderIdentity(reminder);
      fingerprints.add(reminderSourceFingerprint(source, occurrenceKey, reminderKey));
    }
  }
  return fingerprints;
}

export function reminderWindow(now: number): ReminderDeliveryWindow {
  return {
    catchUpStart: now - CALENDAR_REMINDER_CATCH_UP_SECONDS,
    scheduleEnd: now + CALENDAR_REMINDER_SCHEDULE_HORIZON_SECONDS,
  };
}
