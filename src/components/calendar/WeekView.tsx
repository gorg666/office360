import { useMemo } from "react";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { CalendarProviderCapabilities } from "@/services/calendar/domain";
import { useUIStore } from "@/stores/uiStore";
import { eventOccursOnDate } from "./eventTimeProjection";
import { TimedGridOverlay, WEEK_HOUR_HEIGHT_PX, type TimedDraft, type TimedVisualOverride } from "./timedGrid";

interface WeekViewProps {
  currentDate: Date;
  events: DbCalendarEvent[];
  onEventClick: (event: DbCalendarEvent, anchor: { x: number; y: number }) => void;
  capabilities?: CalendarProviderCapabilities | null;
  pendingEventIds?: ReadonlySet<string>;
  visualOverrides?: Readonly<Record<string, TimedVisualOverride>>;
  onTimedCommit?: (event: DbCalendarEvent, draft: TimedDraft, anchor: { x: number; y: number }) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_NAMES = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ru: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
} as const;

export function WeekView({
  currentDate,
  events,
  onEventClick,
  capabilities = null,
  pendingEventIds,
  visualOverrides,
  onTimedCommit,
}: WeekViewProps) {
  const locale = useUIStore((state) => state.locale);
  const weekStart = new Date(currentDate);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const pending = pendingEventIds ?? new Set<string>();

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const today = new Date();
  const todayStr = today.toDateString();

  const allDayByDay = useMemo(() => {
    const adMap = new Map<number, DbCalendarEvent[]>();
    for (const day of days) {
      for (const event of events) {
        if (!event.is_all_day || !eventOccursOnDate(event, day)) continue;
        const list = adMap.get(day.getDate());
        if (list) list.push(event);
        else adMap.set(day.getDate(), [event]);
      }
    }
    return adMap;
  }, [events, days]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border-primary shrink-0">
        <div className="border-r border-border-secondary" />
        {days.map((day, i) => {
          const isToday = day.toDateString() === todayStr;
          return (
            <div key={i} className="px-2 py-2 text-center border-r border-border-secondary">
              <div className="text-xs text-text-tertiary">{DAY_NAMES[locale][day.getDay()]}</div>
              <div className={`text-sm font-medium mt-0.5 w-7 h-7 flex items-center justify-center mx-auto rounded-full ${
                isToday ? "bg-accent text-white" : "text-text-primary"
              }`}>
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border-primary shrink-0">
        <div className="border-r border-border-secondary px-1 py-1 text-[0.625rem] text-text-tertiary">
          {locale === "ru" ? "весь день" : "all-day"}
        </div>
        {days.map((day, i) => {
          const allDay = allDayByDay.get(day.getDate()) ?? [];
          return (
            <div key={i} className="border-r border-border-secondary px-1 py-1 space-y-0.5">
              {allDay.map((e) => (
                <button
                  key={e.id}
                  onClick={(mouseEvent) => onEventClick(e, { x: mouseEvent.clientX, y: mouseEvent.clientY })}
                  className="w-full text-left text-[0.625rem] px-1 py-0.5 rounded bg-accent/10 text-accent truncate hover:bg-accent/20 transition-colors"
                >
                  {e.summary ?? (locale === "ru" ? "Событие" : "Event")}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="relative">
          <div className="grid grid-cols-[60px_repeat(7,1fr)]">
            {HOURS.map((hour) => (
              <div key={hour} className="contents">
                <div className="border-r border-b border-border-secondary h-12 px-1 flex items-start justify-end">
                  <span className="text-[0.625rem] text-text-tertiary -mt-1.5">
                    {hour === 0 ? "" : `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`}
                  </span>
                </div>
                {days.map((_, di) => (
                  <div key={di} className="border-r border-b border-border-secondary h-12 relative px-0.5" />
                ))}
              </div>
            ))}
          </div>
          <div className="absolute top-0 right-0 bottom-0 left-[60px]">
            <TimedGridOverlay
              days={days}
              hourHeightPx={WEEK_HOUR_HEIGHT_PX}
              events={events}
              capabilities={capabilities}
              pendingEventIds={pending}
              visualOverrides={visualOverrides}
              locale={locale}
              onEventClick={onEventClick}
              onGestureCommit={onTimedCommit ?? (() => {})}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
