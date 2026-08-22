import { useMemo, useRef, useState } from "react";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { CalendarDate } from "@/services/calendar/domain";
import { calendarDateFromLocalDate } from "@/services/calendar/domain";
import type { CalendarProviderCapabilities } from "@/services/calendar/domain";
import { EventCard } from "./EventCard";
import { useUIStore } from "@/stores/uiStore";
import { eventOccursOnDate } from "./eventTimeProjection";
import { DRAG_THRESHOLD_PX } from "./timedGrid/constants";
import { pointerExceedsDragThreshold } from "./timedGrid/geometry";
import type { TimedVisualOverride } from "./timedGrid";
import {
  applyDateGridDraft,
  calendarDateDiffDays,
  canDragDateEvent,
  dateGridPreviewLabel,
  formatEventAriaLabel,
  hitTestCalendarDate,
  type DateGridDraft,
} from "./dateGrid";

interface MonthViewProps {
  currentDate: Date;
  events: DbCalendarEvent[];
  onEventClick: (event: DbCalendarEvent, anchor: { x: number; y: number }) => void;
  capabilities?: CalendarProviderCapabilities | null;
  pendingEventIds?: ReadonlySet<string>;
  visualOverrides?: Readonly<Record<string, TimedVisualOverride>>;
  onDateCommit?: (event: DbCalendarEvent, draft: DateGridDraft, anchor: { x: number; y: number }) => void;
}

const DAY_NAMES = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ru: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
} as const;

interface MonthGesture {
  event: DbCalendarEvent;
  originDate: CalendarDate;
  originX: number;
  originY: number;
  dragging: boolean;
  dropDate: CalendarDate | null;
}

export function MonthView({
  currentDate,
  events,
  onEventClick,
  capabilities = null,
  pendingEventIds,
  visualOverrides,
  onDateCommit,
}: MonthViewProps) {
  const locale = useUIStore((state) => state.locale);
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const totalDays = lastDay.getDate();
  const today = new Date();
  const todayKey = calendarDateFromLocalDate(today);
  const pending = pendingEventIds ?? new Set<string>();
  const suppressClickRef = useRef(false);
  const gestureRef = useRef<MonthGesture | null>(null);
  const [gesture, setGesture] = useState<MonthGesture | null>(null);

  const cells = useMemo(() => {
    const gridStart = new Date(year, month, 1 - startOffset);
    const count = Math.ceil((startOffset + totalDays) / 7) * 7;
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return { date, inMonth: date.getMonth() === month, key: calendarDateFromLocalDate(date) };
    });
  }, [year, month, startOffset, totalDays]);

  const layoutEvents = useMemo(() => {
    return events.map((event) => {
      const override = visualOverrides?.[event.id];
      return override ? { ...event, ...override } : event;
    });
  }, [events, visualOverrides]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, DbCalendarEvent[]>();
    for (const cell of cells) {
      const dayEvents = layoutEvents.filter((event) => eventOccursOnDate(event, cell.date));
      if (dayEvents.length > 0) map.set(cell.key, dayEvents);
    }
    return map;
  }, [layoutEvents, cells]);

  function begin(event: DbCalendarEvent, originDate: CalendarDate, pointerEvent: React.PointerEvent<HTMLElement>) {
    if (pointerEvent.button !== 0) return;
    const next: MonthGesture = {
      event,
      originDate,
      originX: pointerEvent.clientX,
      originY: pointerEvent.clientY,
      dragging: false,
      dropDate: originDate,
    };
    gestureRef.current = next;
    setGesture(next);
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
  }

  function track(pointerEvent: React.PointerEvent<HTMLElement>) {
    const state = gestureRef.current;
    if (!state) return;
    const dx = pointerEvent.clientX - state.originX;
    const dy = pointerEvent.clientY - state.originY;
    if (!state.dragging && !pointerExceedsDragThreshold(dx, dy, DRAG_THRESHOLD_PX)) return;
    const dropDate = hitTestCalendarDate(pointerEvent.clientX, pointerEvent.clientY) ?? state.dropDate;
    const next = { ...state, dragging: true, dropDate };
    gestureRef.current = next;
    setGesture(next);
  }

  function end(pointerEvent: React.PointerEvent<HTMLElement>) {
    const state = gestureRef.current;
    gestureRef.current = null;
    setGesture(null);
    if (!state?.dragging || !state.dropDate || !onDateCommit) return;
    suppressClickRef.current = true;
    const deltaDays = calendarDateDiffDays(state.originDate, state.dropDate);
    const draft: DateGridDraft = { type: "shift", deltaDays };
    const applied = applyDateGridDraft(state.event, draft);
    if (!applied.ok || applied.unchanged) return;
    onDateCommit(state.event, draft, { x: pointerEvent.clientX, y: pointerEvent.clientY });
  }

  function cancel() {
    gestureRef.current = null;
    setGesture(null);
  }

  const previewDraft: DateGridDraft | null = gesture?.dragging && gesture.dropDate
    ? { type: "shift", deltaDays: calendarDateDiffDays(gesture.originDate, gesture.dropDate) }
    : null;
  const preview = previewDraft ? applyDateGridDraft(gesture!.event, previewDraft) : null;
  const previewText = preview?.ok ? dateGridPreviewLabel(preview.time, locale) : null;
  const previewDate = gesture?.dropDate ?? null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden" data-testid="month-view">
      <div className="grid grid-cols-7 border-b border-border-primary">
        {DAY_NAMES[locale].map((name) => (
          <div key={name} className="px-2 py-2 text-xs font-medium text-text-tertiary text-center">
            {name}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 flex-1 auto-rows-fr overflow-y-auto">
        {cells.map((cell) => {
          const isToday = cell.key === todayKey;
          const dayEvents = eventsByDay.get(cell.key) ?? [];
          const isTarget = previewDate === cell.key && gesture?.dragging;

          return (
            <div
              key={cell.key}
              data-calendar-date={cell.key}
              data-testid={`month-cell-${cell.key}`}
              className={`border-b border-r border-border-secondary p-1 min-h-[80px] ${
                cell.inMonth ? "" : "bg-bg-tertiary/30"
              } ${isTarget ? "bg-accent/10" : ""}`}
            >
              <div className={`text-xs font-medium mb-0.5 w-6 h-6 flex items-center justify-center rounded-full ${
                isToday ? "bg-accent text-white" : cell.inMonth ? "text-text-secondary" : "text-text-tertiary"
              }`}>
                {cell.date.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((event) => {
                  const interactive = Boolean(onDateCommit)
                    && canDragDateEvent(event, capabilities)
                    && !pending.has(event.id);
                  const live = gesture?.event.id === event.id && gesture.dragging;
                  return (
                    <EventCard
                      key={event.id}
                      event={event}
                      compact
                      interactive={interactive}
                      dragging={live}
                      disabled={pending.has(event.id)}
                      ariaLabel={formatEventAriaLabel(event, locale)}
                      onPointerDown={(pointerEvent) => {
                        if (!interactive) return;
                        begin(event, cell.key, pointerEvent);
                      }}
                      onPointerMove={track}
                      onPointerUp={end}
                      onPointerCancel={cancel}
                      onClick={(mouseEvent) => {
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false;
                          return;
                        }
                        onEventClick(event, { x: mouseEvent.clientX, y: mouseEvent.clientY });
                      }}
                    />
                  );
                })}
                {dayEvents.length > 3 && (
                  <div className="text-[0.625rem] text-text-tertiary pl-1">
                    +{dayEvents.length - 3} {locale === "ru" ? "ещё" : "more"}
                  </div>
                )}
                {isTarget ? (
                  <div
                    data-testid="month-drag-preview"
                    className="pointer-events-none text-[0.625rem] px-1 py-0.5 rounded bg-accent/40 text-accent ring-1 ring-accent truncate"
                  >
                    {gesture?.event.summary}
                    {previewText ? <span className="ml-1 opacity-80">{previewText}</span> : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
