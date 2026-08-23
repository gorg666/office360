import { MAX_CALENDAR_REMINDER_SECONDS } from "../domain";
import {
  showCalendarReminderNotification,
  getNotificationPermissionStatus,
  type CalendarNotificationResult,
} from "@/services/notifications/notificationManager";
import {
  cancelCalendarReminderDelivery,
  claimDueCalendarReminderDeliveries,
  completeCalendarReminderDelivery,
  dismissCalendarReminderDelivery,
  failCalendarReminderDelivery,
  getCalendarReminderSources,
  getUnhandledCalendarReminderDeliveries,
  getNextCalendarReminderDeliveryAt,
  getReminderSourceForDelivery,
  reconcileCalendarReminderDeliveries,
  requeuePermissionDeniedCalendarReminders,
  snoozeCalendarReminderDelivery,
} from "@/services/db/calendarReminderDeliveries";
import {
  activeReminderFingerprints,
  CALENDAR_REMINDER_CATCH_UP_SECONDS,
  CALENDAR_REMINDER_LEASE_SECONDS,
  planReminderOccurrences,
  reminderWindow,
  type ReminderDelivery,
  type ReminderSourceEvent,
} from "./domain";

export const CALENDAR_REMINDER_RECONCILE_EVENT = "office360-calendar-reminders-reconcile";
export const CALENDAR_REMINDER_DELIVERED_EVENT = "office360-calendar-reminder-delivered";
export const CALENDAR_REMINDER_STATUS_EVENT = "office360-calendar-reminder-status";
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const CLOCK_CHANGE_RECHECK_SECONDS = 15 * 60;

export interface CalendarReminderUiDelivery {
  deliveryKey: string;
  title: string;
  body: string;
  scheduledAt: number;
  privacyProtected: boolean;
}

interface SchedulerDependencies {
  now: () => number;
  getSources: typeof getCalendarReminderSources;
  reconcile: typeof reconcileCalendarReminderDeliveries;
  claimDue: typeof claimDueCalendarReminderDeliveries;
  sourceForDelivery: typeof getReminderSourceForDelivery;
  complete: typeof completeCalendarReminderDelivery;
  fail: typeof failCalendarReminderDelivery;
  cancel: typeof cancelCalendarReminderDelivery;
  nextScheduledAt: typeof getNextCalendarReminderDeliveryAt;
  notify: typeof showCalendarReminderNotification;
  permissionStatus: typeof getNotificationPermissionStatus;
  requeuePermissionDenied: typeof requeuePermissionDeniedCalendarReminders;
  emitDelivered: (delivery: CalendarReminderUiDelivery) => void;
  emitStatus: (result: CalendarNotificationResult) => void;
}

const defaultDependencies: SchedulerDependencies = {
  now: () => Math.floor(Date.now() / 1000),
  getSources: getCalendarReminderSources,
  reconcile: reconcileCalendarReminderDeliveries,
  claimDue: claimDueCalendarReminderDeliveries,
  sourceForDelivery: getReminderSourceForDelivery,
  complete: completeCalendarReminderDelivery,
  fail: failCalendarReminderDelivery,
  cancel: cancelCalendarReminderDelivery,
  nextScheduledAt: getNextCalendarReminderDeliveryAt,
  notify: showCalendarReminderNotification,
  permissionStatus: getNotificationPermissionStatus,
  requeuePermissionDenied: requeuePermissionDeniedCalendarReminders,
  emitDelivered: (delivery) => window.dispatchEvent(new CustomEvent(CALENDAR_REMINDER_DELIVERED_EVENT, { detail: delivery })),
  emitStatus: (result) => window.dispatchEvent(new CustomEvent(CALENDAR_REMINDER_STATUS_EVENT, { detail: result })),
};

export class ReminderScheduler {
  private reconcilePromise: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private readonly listeners: Array<() => void> = [];

  constructor(private readonly dependencies: SchedulerDependencies = defaultDependencies) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    if (typeof window !== "undefined") {
      const trigger = () => { void this.reconcileNow(); };
      const onVisibility = () => {
        if (document.visibilityState === "visible") trigger();
      };
      for (const eventName of ["velo-sync-done", "online", "focus", CALENDAR_REMINDER_RECONCILE_EVENT]) {
        window.addEventListener(eventName, trigger);
        this.listeners.push(() => window.removeEventListener(eventName, trigger));
      }
      document.addEventListener("visibilitychange", onVisibility);
      this.listeners.push(() => document.removeEventListener("visibilitychange", onVisibility));
    }
    void this.reconcileNow();
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.splice(0).forEach((remove) => remove());
  }

  reconcileNow(): Promise<void> {
    if (this.reconcilePromise) return this.reconcilePromise;
    this.reconcilePromise = this.run().finally(() => {
      this.reconcilePromise = null;
    });
    return this.reconcilePromise;
  }

  private async run(): Promise<void> {
    const now = this.dependencies.now();
    const window = reminderWindow(now);
    const sources = await this.dependencies.getSources(
      window.catchUpStart,
      window.scheduleEnd + MAX_CALENDAR_REMINDER_SECONDS,
    );
    const planned = planReminderOccurrences(sources, window);
    await this.dependencies.reconcile(planned, activeReminderFingerprints(sources), window);
    if (this.dependencies.permissionStatus() === "granted") {
      await this.dependencies.requeuePermissionDenied(window.catchUpStart);
    }
    const due = await this.dependencies.claimDue({
      now,
      catchUpStart: window.catchUpStart,
      leaseSeconds: CALENDAR_REMINDER_LEASE_SECONDS,
    });
    for (const delivery of due) await this.deliver(delivery, now);
    await this.scheduleNextWake(now);
  }

  private async deliver(delivery: ReminderDelivery, now: number): Promise<void> {
    const source = await this.dependencies.sourceForDelivery(delivery);
    if (!source || source.status.toLowerCase() === "cancelled") {
      await this.dependencies.cancel(delivery.deliveryKey, now);
      return;
    }
    if (!activeReminderFingerprints([source]).has(delivery.sourceFingerprint)) {
      await this.dependencies.cancel(delivery.deliveryKey, now);
      return;
    }

    const payload = calendarNotificationPayload(delivery, source);
    // Persist the dedupe boundary before invoking the OS side effect. A crash in
    // the narrow interval below may miss a notification, but it cannot replay it
    // after the delivery lease expires.
    await this.dependencies.complete(delivery.deliveryKey, now);
    const result = await this.dependencies.notify({ title: payload.title, body: payload.body });
    this.dependencies.emitStatus(result);
    if (result.status !== "delivered") {
      await this.dependencies.fail(delivery.deliveryKey, now, result.status);
      return;
    }
    this.dependencies.emitDelivered(payload);
  }

  private async scheduleNextWake(now: number): Promise<void> {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    const next = await this.dependencies.nextScheduledAt(now);
    // Reconcile at the next exact due instant. If the rolling horizon is empty,
    // use a bounded clock-change safety refresh rather than polling every second.
    const safetyDelayMs = CLOCK_CHANGE_RECHECK_SECONDS * 1000;
    const delayMs = next === null
      ? safetyDelayMs
      : Math.max(250, Math.min((next - now) * 1000, safetyDelayMs, MAX_TIMER_DELAY_MS));
    this.timer = setTimeout(() => { void this.reconcileNow(); }, delayMs);
  }
}

export function calendarNotificationPayload(
  delivery: ReminderDelivery,
  source: ReminderSourceEvent,
): CalendarReminderUiDelivery {
  if (!source.canSeeEventDetails) {
    return {
      deliveryKey: delivery.deliveryKey,
      title: "Calendar reminder",
      body: "Busy event",
      scheduledAt: delivery.scheduledAt,
      privacyProtected: true,
    };
  }
  const eventTitle = source.summary?.trim() || "Calendar event";
  const time = formatReminderEventTime(source);
  return {
    deliveryKey: delivery.deliveryKey,
    title: eventTitle,
    body: [time, source.calendarName].filter(Boolean).join(" · ") || "Calendar event",
    scheduledAt: delivery.scheduledAt,
    privacyProtected: false,
  };
}

function formatReminderEventTime(source: ReminderSourceEvent): string | null {
  try {
    if (source.timeKind === "all-day") {
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" })
        .format(new Date(source.startTime * 1000));
    }
    if (source.timeKind === "timed-zoned" && source.tzid) {
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: source.tzid })
        .format(new Date(source.startTime * 1000));
    }
    if (source.timeKind === "floating" && source.wallStart) {
      const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(source.wallStart);
      if (!match) return null;
      const instant = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })
        .format(new Date(instant));
    }
  } catch {
    // Semantic scheduling remains valid; omit a time label rather than display
    // it using the host timezone after an unexpected formatter failure.
  }
  return null;
}

const calendarReminderScheduler = new ReminderScheduler();

export function startCalendarReminderScheduler(): void {
  calendarReminderScheduler.start();
}

export function stopCalendarReminderScheduler(): void {
  calendarReminderScheduler.stop();
}

export function reconcileCalendarReminderSchedule(): Promise<void> {
  return calendarReminderScheduler.reconcileNow();
}

export async function dismissCalendarReminder(deliveryKey: string): Promise<void> {
  await dismissCalendarReminderDelivery(deliveryKey, Math.floor(Date.now() / 1000));
}

export async function snoozeCalendarReminder(deliveryKey: string, minutes: number): Promise<void> {
  const preset = [5, 10, 30, 60].includes(minutes);
  if (!preset) throw new Error("Unsupported Calendar reminder snooze duration");
  const now = Math.floor(Date.now() / 1000);
  await snoozeCalendarReminderDelivery(deliveryKey, now + minutes * 60, now);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CALENDAR_REMINDER_RECONCILE_EVENT));
  }
}

export async function loadUnhandledCalendarReminders(): Promise<CalendarReminderUiDelivery[]> {
  const now = Math.floor(Date.now() / 1000);
  const deliveries = await getUnhandledCalendarReminderDeliveries(
    now - CALENDAR_REMINDER_CATCH_UP_SECONDS,
  );
  const result: CalendarReminderUiDelivery[] = [];
  for (const delivery of deliveries) {
    const source = await getReminderSourceForDelivery(delivery);
    if (source) result.push(calendarNotificationPayload(delivery, source));
  }
  return result;
}
