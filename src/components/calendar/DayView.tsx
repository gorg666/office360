import { useMemo, useState } from "react";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { CalendarDate, CalendarProviderCapabilities } from "@/services/calendar/domain";
import { calendarDateFromLocalDate } from "@/services/calendar/domain";
import { useUIStore } from "@/stores/uiStore";
import { eventOccursOnDate } from "./eventTimeProjection";
import { DAY_HOUR_HEIGHT_PX, TimedGridOverlay, type TimedDraft, type TimedVisualOverride } from "./timedGrid";
import { AllDayLane, type DateGridDraft } from "./dateGrid";
import type { GridCreateDraft } from "./createSelection";
import { isTodayInDisplayTimeZone } from "./displayTimeIndicator";

interface DayViewProps {
  currentDate: Date;
  events: DbCalendarEvent[];
  displayTimeZone: string;
  onEventClick: (event: DbCalendarEvent, anchor: { x: number; y: number }) => void;
  capabilities?: CalendarProviderCapabilities | null;
  pendingEventIds?: ReadonlySet<string>;
  visualOverrides?: Readonly<Record<string, TimedVisualOverride>>;
  onTimedCommit?: (event: DbCalendarEvent, draft: TimedDraft, anchor: { x: number; y: number }) => void;
  onDateCommit?: (event: DbCalendarEvent, draft: DateGridDraft, anchor: { x: number; y: number }) => void;
  onCreateDraft?: (draft: GridCreateDraft) => void;
  canUpdateEvent?: (event: DbCalendarEvent) => boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function DayView({
  currentDate,
  events,
  displayTimeZone,
  onEventClick,
  capabilities = null,
  pendingEventIds,
  visualOverrides,
  onTimedCommit,
  onDateCommit,
  onCreateDraft,
  canUpdateEvent = () => true,
}: DayViewProps) {
  const locale = useUIStore((state) => state.locale);
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  const dayStart = new Date(currentDate);
  dayStart.setHours(0, 0, 0, 0);
  const pending = pendingEventIds ?? new Set<string>();
  const [conversionHighlight, setConversionHighlight] = useState<CalendarDate | null>(null);
  const isToday = isTodayInDisplayTimeZone(currentDate, displayTimeZone);

  const layoutEvents = useMemo(() => {
    return events.map((event) => {
      const override = visualOverrides?.[event.id];
      return override ? { ...event, ...override } : event;
    });
  }, [events, visualOverrides]);

  const allDayByDay = useMemo(() => {
    const key = calendarDateFromLocalDate(dayStart);
    const list = layoutEvents.filter((event) => (
      (event.is_all_day === 1 || event.time_kind === "all-day") && eventOccursOnDate(event, dayStart)
    ));
    return new Map([[key, list]]);
  }, [layoutEvents, dayStart]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden" data-testid="day-view">
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

      {onDateCommit ? (
        <AllDayLane
          days={[dayStart]}
          capabilities={capabilities}
          pendingEventIds={pending}
          locale={locale}
          hourHeightPx={DAY_HOUR_HEIGHT_PX}
          onEventClick={onEventClick}
          onDateCommit={onDateCommit}
          eventsByDay={allDayByDay}
          conversionHighlight={conversionHighlight}
          onCreateDraft={onCreateDraft}
          canUpdateEvent={canUpdateEvent}
        />
      ) : (allDayByDay.get(calendarDateFromLocalDate(dayStart)) ?? []).length > 0 ? (
        <div className="px-6 py-2 border-b border-border-secondary space-y-1">
          {(allDayByDay.get(calendarDateFromLocalDate(dayStart)) ?? []).map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={(mouseEvent) => onEventClick(event, { x: mouseEvent.clientX, y: mouseEvent.clientY })}
              className="w-full text-left text-xs px-2 py-1.5 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              {event.summary ?? (locale === "ru" ? "Событие" : "Event")} · {locale === "ru" ? "весь день" : "All day"}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        <div className="relative">
          {HOURS.map((hour) => (
            <div key={hour} className="flex border-b border-border-secondary h-14">
              <div className="w-[60px] shrink-0 px-2 flex items-start justify-end -mt-1.5">
                <span className="text-[0.625rem] text-text-tertiary">
                  {hour === 0 ? "" : `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`}
                </span>
              </div>
              <div className="flex-1 relative px-1" />
            </div>
          ))}
          <div className="absolute top-0 right-0 bottom-0 left-[60px]">
            <TimedGridOverlay
              days={[dayStart]}
              hourHeightPx={DAY_HOUR_HEIGHT_PX}
              displayTimeZone={displayTimeZone}
              events={layoutEvents}
              capabilities={capabilities}
              pendingEventIds={pending}
              visualOverrides={visualOverrides}
              locale={locale}
              onEventClick={onEventClick}
              onGestureCommit={onTimedCommit ?? (() => {})}
              onConvertToAllDay={onDateCommit}
              onConvertPreview={setConversionHighlight}
              onCreateDraft={onCreateDraft}
              canUpdateEvent={canUpdateEvent}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
