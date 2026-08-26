import { useMemo, useState } from "react";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { CalendarDate, CalendarProviderCapabilities } from "@/services/calendar/domain";
import { calendarDateFromLocalDate } from "@/services/calendar/domain";
import { useUIStore } from "@/stores/uiStore";
import { eventOccursOnDate } from "./eventTimeProjection";
import { TimedGridOverlay, WEEK_HOUR_HEIGHT_PX, type TimedDraft, type TimedVisualOverride } from "./timedGrid";
import { AllDayLane, type DateGridDraft } from "./dateGrid";
import type { GridCreateDraft } from "./createSelection";
import { isTodayInDisplayTimeZone } from "./displayTimeIndicator";
import { orderedDayNames, startOfWeek } from "./weekLocale";

interface WeekViewProps {
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

export function WeekView({
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
}: WeekViewProps) {
  const locale = useUIStore((state) => state.locale);
  const weekStart = startOfWeek(currentDate, locale);
  const pending = pendingEventIds ?? new Set<string>();
  const [conversionHighlight, setConversionHighlight] = useState<CalendarDate | null>(null);
  const dayNames = orderedDayNames(locale);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const layoutEvents = useMemo(() => {
    return events.map((event) => {
      const override = visualOverrides?.[event.id];
      return override ? { ...event, ...override } : event;
    });
  }, [events, visualOverrides]);

  const allDayByDay = useMemo(() => {
    const adMap = new Map<string, DbCalendarEvent[]>();
    for (const day of days) {
      const key = calendarDateFromLocalDate(day);
      for (const event of layoutEvents) {
        if (event.is_all_day !== 1 && event.time_kind !== "all-day") continue;
        if (!eventOccursOnDate(event, day)) continue;
        const list = adMap.get(key);
        if (list) list.push(event);
        else adMap.set(key, [event]);
      }
    }
    return adMap;
  }, [layoutEvents, days]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden" data-testid="week-view">
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border-primary shrink-0">
        <div className="border-r border-border-secondary" />
        {days.map((day, i) => {
          const isToday = isTodayInDisplayTimeZone(day, displayTimeZone);
          return (
            <div key={i} className="px-2 py-2 text-center border-r border-border-secondary">
              <div className="text-xs text-text-tertiary">{dayNames[i]}</div>
              <div className={`text-sm font-medium mt-0.5 w-7 h-7 flex items-center justify-center mx-auto rounded-full ${
                isToday ? "bg-accent text-white" : "text-text-primary"
              }`}>
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {onDateCommit ? (
        <AllDayLane
          days={days}
          capabilities={capabilities}
          pendingEventIds={pending}
          locale={locale}
          hourHeightPx={WEEK_HOUR_HEIGHT_PX}
          onEventClick={onEventClick}
          onDateCommit={onDateCommit}
          eventsByDay={allDayByDay}
          conversionHighlight={conversionHighlight}
          onCreateDraft={onCreateDraft}
          canUpdateEvent={canUpdateEvent}
        />
      ) : (
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border-primary shrink-0">
          <div className="border-r border-border-secondary px-1 py-1 text-[0.625rem] text-text-tertiary">
            {locale === "ru" ? "весь день" : "all-day"}
          </div>
          {days.map((day, i) => {
            const allDay = allDayByDay.get(calendarDateFromLocalDate(day)) ?? [];
            return (
              <div key={i} className="border-r border-border-secondary px-1 py-1 space-y-0.5">
                {allDay.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={(mouseEvent) => onEventClick(event, { x: mouseEvent.clientX, y: mouseEvent.clientY })}
                    className="w-full text-left text-[0.625rem] px-1 py-0.5 rounded bg-accent/10 text-accent truncate hover:bg-accent/20 transition-colors"
                  >
                    {event.summary ?? (locale === "ru" ? "Событие" : "Event")}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

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
