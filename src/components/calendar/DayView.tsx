import { useMemo } from "react";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { CalendarProviderCapabilities } from "@/services/calendar/domain";
import { useUIStore } from "@/stores/uiStore";
import { eventOccursOnDate } from "./eventTimeProjection";
import { DAY_HOUR_HEIGHT_PX, TimedGridOverlay, type TimedDraft, type TimedVisualOverride } from "./timedGrid";

interface DayViewProps {
  currentDate: Date;
  events: DbCalendarEvent[];
  onEventClick: (event: DbCalendarEvent, anchor: { x: number; y: number }) => void;
  capabilities?: CalendarProviderCapabilities | null;
  pendingEventIds?: ReadonlySet<string>;
  visualOverrides?: Readonly<Record<string, TimedVisualOverride>>;
  onTimedCommit?: (event: DbCalendarEvent, draft: TimedDraft, anchor: { x: number; y: number }) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function DayView({
  currentDate,
  events,
  onEventClick,
  capabilities = null,
  pendingEventIds,
  visualOverrides,
  onTimedCommit,
}: DayViewProps) {
  const locale = useUIStore((state) => state.locale);
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  const dayStart = new Date(currentDate);
  dayStart.setHours(0, 0, 0, 0);
  const pending = pendingEventIds ?? new Set<string>();

  const allDayEvents = useMemo(
    () => events.filter((event) => event.is_all_day && eventOccursOnDate(event, dayStart)),
    [events, dayStart],
  );
  const isToday = new Date().toDateString() === currentDate.toDateString();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-6 py-3 border-b border-border-primary flex items-center gap-3 shrink-0">
        <div className={`text-2xl font-bold w-10 h-10 flex items-center justify-center rounded-full ${
          isToday ? "bg-accent text-white" : "text-text-primary"
        }`}>
          {currentDate.getDate()}
        </div>
        <div className="text-sm text-text-secondary">
          {new Intl.DateTimeFormat(intlLocale, { weekday: "long" }).format(currentDate)}
        </div>
      </div>

      {allDayEvents.length > 0 && (
        <div className="px-6 py-2 border-b border-border-secondary space-y-1">
          {allDayEvents.map((e) => (
            <button
              key={e.id}
              onClick={(mouseEvent) => onEventClick(e, { x: mouseEvent.clientX, y: mouseEvent.clientY })}
              className="w-full text-left text-xs px-2 py-1.5 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              {e.summary ?? (locale === "ru" ? "Событие" : "Event")} · {locale === "ru" ? "весь день" : "All day"}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="relative">
          {HOURS.map((hour) => (
            <div key={hour} className="flex border-b border-border-secondary h-14">
              <div className="w-16 shrink-0 px-2 flex items-start justify-end -mt-1.5">
                <span className="text-[0.625rem] text-text-tertiary">
                  {hour === 0 ? "" : `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`}
                </span>
              </div>
              <div className="flex-1 relative px-1" />
            </div>
          ))}
          <div className="absolute top-0 right-0 bottom-0 left-16">
            <TimedGridOverlay
              days={[dayStart]}
              hourHeightPx={DAY_HOUR_HEIGHT_PX}
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
