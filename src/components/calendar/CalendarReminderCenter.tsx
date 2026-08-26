import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import {
  CALENDAR_REMINDER_DELIVERED_EVENT,
  CALENDAR_REMINDER_SNOOZE_PRESETS_MINUTES,
  CALENDAR_REMINDER_STATUS_EVENT,
  dismissCalendarReminder,
  loadUnhandledCalendarReminders,
  snoozeCalendarReminder,
  type CalendarReminderUiDelivery,
} from "@/services/calendar/reminderDelivery";
import type { CalendarNotificationResult, NotificationPermissionStatus } from "@/services/notifications/notificationManager";
import { navigateToLabel } from "@/router/navigate";

export function CalendarReminderCenter() {
  const [deliveries, setDeliveries] = useState<CalendarReminderUiDelivery[]>([]);
  const [notificationIssue, setNotificationIssue] = useState<NotificationPermissionStatus | null>(null);

  useEffect(() => {
    let active = true;
    void loadUnhandledCalendarReminders().then((items) => {
      if (active) setDeliveries((current) => uniqueDeliveries([...items, ...current]));
    }).catch(() => {});

    const onDelivered = (event: Event) => {
      const detail = (event as CustomEvent<CalendarReminderUiDelivery>).detail;
      if (detail) setDeliveries((current) => uniqueDeliveries([detail, ...current]));
    };
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<CalendarNotificationResult>).detail;
      if (detail && detail.status !== "delivered") setNotificationIssue(detail.permission);
    };
    window.addEventListener(CALENDAR_REMINDER_DELIVERED_EVENT, onDelivered);
    window.addEventListener(CALENDAR_REMINDER_STATUS_EVENT, onStatus);
    return () => {
      active = false;
      window.removeEventListener(CALENDAR_REMINDER_DELIVERED_EVENT, onDelivered);
      window.removeEventListener(CALENDAR_REMINDER_STATUS_EVENT, onStatus);
    };
  }, []);

  const remove = (deliveryKey: string) => {
    setDeliveries((current) => current.filter((item) => item.deliveryKey !== deliveryKey));
  };

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2">
      {notificationIssue && (
        <div role="status" className="material-elevated pointer-events-auto rounded-card px-3 py-2 text-caption text-ink-primary">
          <div className="flex items-start gap-2">
            <Bell className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{notificationIssue === "disabled"
              ? "Уведомления отключены в настройках Office360. Календарь продолжает работать."
              : notificationIssue === "unknown"
                ? "Не удалось определить разрешение системных уведомлений. Календарь продолжает работать."
                : "Системные уведомления отключены. Календарь продолжает работать, но напоминания не показываются."}</span>
            <button type="button" aria-label="Закрыть сообщение" onClick={() => setNotificationIssue(null)}><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
      {deliveries.map((delivery) => (
        <section key={delivery.deliveryKey} role="alert" aria-label="Напоминание календаря" className="material-elevated materialize pointer-events-auto rounded-panel p-3 text-meta text-ink-primary">
          <div className="flex items-start gap-2">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-accent-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{delivery.title}</div>
              <div className="mt-0.5 text-xs text-text-secondary">{delivery.body}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CALENDAR_REMINDER_SNOOZE_PRESETS_MINUTES.map((minutes) => (
                  <button
                    type="button"
                    key={minutes}
                    className="focus-ring t-fast rounded-control border border-outline px-2 py-1 text-control hover:bg-brand-tint-1"
                    onClick={() => void snoozeCalendarReminder(delivery.deliveryKey, minutes).then(() => remove(delivery.deliveryKey))}
                  >
                    {minutes === 60 ? "Через 1 ч" : `Через ${minutes} мин`}
                  </button>
                ))}
                <button type="button" className="focus-ring t-fast rounded-control border border-outline px-2 py-1 text-control hover:bg-brand-tint-1" onClick={() => navigateToLabel("calendar")}>Открыть</button>
                <button type="button" className="focus-ring t-fast rounded-control px-2 py-1 text-control text-ink-secondary hover:bg-brand-tint-1" onClick={() => void dismissCalendarReminder(delivery.deliveryKey).then(() => remove(delivery.deliveryKey))}>Отклонить</button>
              </div>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

function uniqueDeliveries(items: readonly CalendarReminderUiDelivery[]): CalendarReminderUiDelivery[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.deliveryKey)) return false;
    seen.add(item.deliveryKey);
    return true;
  });
}
