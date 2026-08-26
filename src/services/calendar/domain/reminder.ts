export type CalendarReminderMethod = "notification" | "email";

export interface CalendarReminderDuration {
  /** Canonical relative duration. Provider adapters may project this to whole minutes. */
  seconds: number;
}

export interface CalendarReminder {
  id?: string;
  method: CalendarReminderMethod;
  trigger: {
    kind: "before-start";
    duration: CalendarReminderDuration;
  };
}

export type CalendarReminderPolicy =
  | { kind: "inherit" }
  | { kind: "none" }
  | { kind: "custom"; reminders: CalendarReminder[] };

export type CalendarReminderDiagnosticCode =
  | "invalid-trigger"
  | "absolute-trigger"
  | "unsupported-action"
  | "unsupported-method"
  | "too-many-reminders";

export interface CalendarReminderDiagnostic {
  code: CalendarReminderDiagnosticCode;
  action?: string;
}

export const MAX_CALENDAR_REMINDER_SECONDS = 28 * 86400;
export const MAX_CALENDAR_REMINDERS = 10;

interface CalendarReminderEnvelopeV1 {
  version: 1;
  policy: CalendarReminderPolicy;
}

export function normalizeCalendarReminderPolicy(policy: CalendarReminderPolicy): CalendarReminderPolicy {
  if (policy.kind !== "custom") return policy;
  if (policy.reminders.length > MAX_CALENDAR_REMINDERS) {
    throw new Error(`At most ${MAX_CALENDAR_REMINDERS} reminders are supported`);
  }

  const seen = new Set<string>();
  const reminders = policy.reminders.flatMap((reminder) => {
    const normalized = normalizeCalendarReminder(reminder);
    const key = `${normalized.method}:${normalized.trigger.duration.seconds}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  }).sort((left, right) =>
    right.trigger.duration.seconds - left.trigger.duration.seconds
      || left.method.localeCompare(right.method),
  );

  return reminders.length > 0 ? { kind: "custom", reminders } : { kind: "none" };
}

export function normalizeCalendarReminder(reminder: CalendarReminder): CalendarReminder {
  if (reminder.method !== "notification" && reminder.method !== "email") {
    throw new Error("Unsupported reminder method");
  }
  if (reminder.trigger.kind !== "before-start") throw new Error("Unsupported reminder trigger");
  const seconds = reminder.trigger.duration.seconds;
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > MAX_CALENDAR_REMINDER_SECONDS) {
    throw new Error("Reminder duration is outside the supported range");
  }
  if (seconds % 60 !== 0) throw new Error("Reminder duration must use whole minutes");
  return {
    ...(reminder.id ? { id: reminder.id } : {}),
    method: reminder.method,
    trigger: { kind: "before-start", duration: { seconds } },
  };
}

export function createCalendarReminder(
  value: number,
  unit: "minutes" | "hours" | "days",
  method: CalendarReminderMethod = "notification",
): CalendarReminder {
  if (!Number.isFinite(value) || value < 0) throw new Error("Reminder value must be non-negative");
  const multiplier = unit === "minutes" ? 60 : unit === "hours" ? 3600 : 86400;
  return normalizeCalendarReminder({
    method,
    trigger: { kind: "before-start", duration: { seconds: value * multiplier } },
  });
}

export function serializeCalendarReminderPolicy(policy: CalendarReminderPolicy): string {
  const envelope: CalendarReminderEnvelopeV1 = {
    version: 1,
    policy: normalizeCalendarReminderPolicy(policy),
  };
  return JSON.stringify(envelope);
}

export function parseCalendarReminderPolicy(value: string | null | undefined): CalendarReminderPolicy | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CalendarReminderEnvelopeV1>;
    if (parsed.version !== 1 || !parsed.policy) return null;
    return normalizeCalendarReminderPolicy(parsed.policy);
  } catch {
    return null;
  }
}
