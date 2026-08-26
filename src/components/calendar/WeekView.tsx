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
import { hourGutterLabel, orderedDayNames, startOfWeek } from "./weekLocale";
import { useCalendarColors } from "./calendarColorContext";
import { WORKING_HOUR_END, WORKING_HOUR_START } from "./workingHours";

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
  const colorFor = useCalendarColors();
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
      <div className="material-subtle grid shrink-0 grid-cols-[60px_repeat(7,1fr)] border-b border-separator">
        <div className="cal-gutter" />
        {days.map((day, i) => {
          const isToday = isTodayInDisplayTimeZone(day, displayTimeZone);
          return (
            <div key={i} className={`cal-day-boundary px-2 py-2 text-center ${isToday ? "cal-today-column" : ""}`}>
              <div className="text-caption uppercase text-ink-tertiary">{dayNames[i]}</div>
              <div className={`mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-meta font-semibold ${
                isToday ? "bg-brand text-brand-contrast" : "text-ink-primary"
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
        <div className="grid shrink-0 grid-cols-[60px_repeat(7,1fr)] border-b border-separator">
          <div className="cal-gutter px-1 py-1 text-caption text-ink-tertiary">
            {locale === "ru" ? "весь день" : "all-day"}
          </div>
          {days.map((day, i) => {
            const allDay = allDayByDay.get(calendarDateFromLocalDate(day)) ?? [];
            return (
              <div key={i} className="cal-day-boundary space-y-0.5 px-1 py-1">
                {allDay.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={(mouseEvent) => onEventClick(event, { x: mouseEvent.clientX, y: mouseEvent.clientY })}
                    className="focus-ring t-fast w-full truncate rounded-tight border-l-[3px] py-0.5 pr-1 pl-1.5 text-left text-caption font-medium"
                    style={{
                      backgroundColor: colorFor(event).fill,
                      borderLeftColor: colorFor(event).marker,
                      color: colorFor(event).text,
                    }}
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
            {HOURS.map((hour) => {
              const offHours = hour < WORKING_HOUR_START || hour >= WORKING_HOUR_END;
              return (
                <div key={hour} className="contents">
                  <div className="cal-gutter cal-gutter-cell flex h-12 items-start justify-end px-1">
                    <span className="-mt-1.5 text-caption tabular-nums text-ink-tertiary">
                      {hourGutterLabel(hour, locale)}
                    </span>
                  </div>
                  {days.map((day, di) => (
                    <div
                      key={di}
                      className={`cal-hour-cell cal-day-boundary relative h-12 px-0.5
                        ${offHours ? "cal-offhours" : ""}
                        ${isTodayInDisplayTimeZone(day, displayTimeZone) ? "cal-today-column" : ""}`}
                    />
                  ))}
                </div>
              );
            })}
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
