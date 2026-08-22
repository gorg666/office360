import { useMemo, useRef, useState } from "react";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { CalendarDate, CalendarProviderCapabilities } from "@/services/calendar/domain";
import { calendarDateFromLocalDate } from "@/services/calendar/domain";
import { MINUTES_PER_DAY, SNAP_MINUTES } from "./constants";
import { canDragResizeTimedEvent } from "./canDragResize";
import {
  clampMinutes,
  eventAxisMinutes,
  hitTestDayIndex,
  minutesToY,
  pointerExceedsDragThreshold,
  snapMinutes,
  visibleSegment,
  weekMinutes,
  weekRangeSegments,
  yToMinutes,
  type TimedGestureMode,
} from "./geometry";
import { packOverlappingEvents } from "./overlapLayout";
import {
  applyTimedDraft,
  clampTimedDraft,
  moveDraft,
  previewLabel,
  resizeDraft,
  type TimedDraft,
} from "./timedEventMutation";
import { formatEventAriaLabel } from "../dateGrid/preview";
import { hitTestAllDayDrop } from "../dateGrid/hitTest";
import type { DateGridDraft } from "../dateGrid/dateShift";
import { DEFAULT_TIMED_DURATION_MINUTES } from "../dateGrid/constants";
import {
  canCreateCalendarEvent,
  formatCreateAriaLabel,
  formatTimedRangeLabel,
  timedClickDraft,
  timedDragDraft,
  type GridCreateDraft,
} from "../createSelection";

export interface TimedVisualOverride {
  start_time: number;
  end_time: number;
  time_kind?: "timed-zoned" | "floating" | "all-day" | null;
  is_all_day?: number;
  end_date_exclusive?: string | null;
}

interface TimedGridOverlayProps {
  days: Date[];
  hourHeightPx: number;
  events: DbCalendarEvent[];
  capabilities: CalendarProviderCapabilities | null;
  pendingEventIds: ReadonlySet<string>;
  visualOverrides?: Readonly<Record<string, TimedVisualOverride>>;
  locale: "ru" | "en";
  onEventClick: (event: DbCalendarEvent, anchor: { x: number; y: number }) => void;
  onGestureCommit: (event: DbCalendarEvent, draft: TimedDraft, anchor: { x: number; y: number }) => void;
  onConvertToAllDay?: (event: DbCalendarEvent, draft: DateGridDraft, anchor: { x: number; y: number }) => void;
  onConvertPreview?: (date: CalendarDate | null) => void;
  onCreateDraft?: (draft: GridCreateDraft) => void;
  canUpdateEvent?: (event: DbCalendarEvent) => boolean;
}

interface GestureState {
  event: DbCalendarEvent;
  mode: TimedGestureMode;
  originX: number;
  originY: number;
  grabOffsetMinutes: number;
  originStartWeekMinutes: number;
  originEndWeekMinutes: number;
  dragging: boolean;
  draft: TimedDraft;
  previewStart: number;
  previewEnd: number;
  convertDate: CalendarDate | null;
}

interface CreateGesture {
  originX: number;
  originY: number;
  originDayIndex: number;
  originMinutes: number;
  currentMinutes: number;
  dragging: boolean;
}

function isExistingTimedEventTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("[data-testid^='timed-event-']"));
}

export function TimedGridOverlay({
  days,
  hourHeightPx,
  events,
  capabilities,
  pendingEventIds,
  visualOverrides,
  locale,
  onEventClick,
  onGestureCommit,
  onConvertToAllDay,
  onConvertPreview,
  onCreateDraft,
  canUpdateEvent = () => true,
}: TimedGridOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const createRef = useRef<CreateGesture | null>(null);
  const suppressClickRef = useRef(false);
  const [gesture, setGesture] = useState<GestureState | null>(null);
  const [createGesture, setCreateGesture] = useState<CreateGesture | null>(null);
  const [focusDayIndex, setFocusDayIndex] = useState(0);
  const [focusMinutes, setFocusMinutes] = useState(9 * 60);
  const canCreate = Boolean(onCreateDraft) && canCreateCalendarEvent(capabilities);

  const dayStarts = useMemo(
    () => days.map((day) => {
      const start = new Date(day);
      start.setHours(0, 0, 0, 0);
      return Math.floor(start.getTime() / 1000);
    }),
    [days],
  );
  const weekStartUnix = dayStarts[0] ?? 0;

  const layoutEvents = useMemo(() => {
    return events
      .filter((event) => event.is_all_day !== 1 && event.time_kind !== "all-day")
      .map((event) => {
        const override = visualOverrides?.[event.id];
        return override ? { ...event, ...override } : event;
      });
  }, [events, visualOverrides]);

  const columns = useMemo(() => {
    return dayStarts.map((dayStart) => {
      const dayEvents = layoutEvents.filter((event) => (
        event.start_time < dayStart + MINUTES_PER_DAY * 60 && event.end_time > dayStart
      ));
      const packed = packOverlappingEvents(dayEvents.map((event) => {
        const axis = eventAxisMinutes(event, dayStart);
        return { id: event.id, start: axis.start, end: axis.end };
      }));
      return { dayStart, dayEvents, packById: new Map(packed.map((item) => [item.id, item])) };
    });
  }, [dayStarts, layoutEvents]);

  const preview = gesture?.dragging ? gesture : null;

  function resolvePoint(clientX: number, clientY: number) {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const dayIndex = hitTestDayIndex(x, rect.width, days.length);
    const minutesOnDay = yToMinutes(y, hourHeightPx);
    return { weekMinutes: weekMinutes(dayIndex, minutesOnDay) };
  }

  function draftFromPointer(state: GestureState, pointerWeekMinutes: number): TimedDraft {
    const raw = state.mode === "move"
      ? moveDraft(snapMinutes(pointerWeekMinutes - state.grabOffsetMinutes) - state.originStartWeekMinutes)
      : state.mode === "resize-start"
        ? resizeDraft("resize-start", snapMinutes(pointerWeekMinutes) - state.originStartWeekMinutes)
        : resizeDraft("resize-end", snapMinutes(pointerWeekMinutes) - state.originEndWeekMinutes);
    return clampTimedDraft(state.event, raw);
  }

  function previewAxis(state: GestureState, draft: TimedDraft) {
    const applied = applyTimedDraft(state.event, draft);
    if (!applied.ok || applied.time.kind === "all-day") {
      return { start: state.originStartWeekMinutes, end: state.originEndWeekMinutes };
    }
    const startUnix = applied.time.kind === "floating"
      ? state.event.start_time + draft.deltaStartMinutes * 60
      : applied.time.start.instant;
    const endUnix = applied.time.kind === "floating"
      ? state.event.end_time + draft.deltaEndMinutes * 60
      : applied.time.end.instant;
    return {
      start: (startUnix - weekStartUnix) / 60,
      end: (endUnix - weekStartUnix) / 60,
    };
  }

  const pointerBind = {
    onPointerMove: trackGesture,
    onPointerUp: endGesture,
    onPointerCancel: cancelGesture,
  };

  function beginGesture(
    event: DbCalendarEvent,
    mode: TimedGestureMode,
    pointerEvent: React.PointerEvent<HTMLElement>,
  ) {
    if (pointerEvent.button !== 0) return;
    if (createRef.current) return;
    const point = resolvePoint(pointerEvent.clientX, pointerEvent.clientY);
    if (!point) return;
    const startWeek = (event.start_time - weekStartUnix) / 60;
    const endWeek = (event.end_time - weekStartUnix) / 60;
    const next: GestureState = {
      event,
      mode,
      originX: pointerEvent.clientX,
      originY: pointerEvent.clientY,
      grabOffsetMinutes: point.weekMinutes - startWeek,
      originStartWeekMinutes: startWeek,
      originEndWeekMinutes: endWeek,
      dragging: false,
      draft: moveDraft(0),
      previewStart: startWeek,
      previewEnd: endWeek,
      convertDate: null,
    };
    gestureRef.current = next;
    setGesture(next);
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
  }

  function trackGesture(pointerEvent: React.PointerEvent<HTMLElement>) {
    const state = gestureRef.current;
    if (!state) return;
    const dx = pointerEvent.clientX - state.originX;
    const dy = pointerEvent.clientY - state.originY;
    if (!state.dragging && !pointerExceedsDragThreshold(dx, dy)) return;
    if (state.mode === "move" && onConvertToAllDay) {
      const allDayDate = hitTestAllDayDrop(pointerEvent.clientX, pointerEvent.clientY);
      if (allDayDate) {
        const next = { ...state, dragging: true, convertDate: allDayDate };
        gestureRef.current = next;
        setGesture(next);
        onConvertPreview?.(allDayDate);
        return;
      }
    }
    onConvertPreview?.(null);
    const point = resolvePoint(pointerEvent.clientX, pointerEvent.clientY);
    if (!point) return;
    const draft = draftFromPointer(state, point.weekMinutes);
    const axis = previewAxis(state, draft);
    const next = { ...state, dragging: true, draft, previewStart: axis.start, previewEnd: axis.end, convertDate: null };
    gestureRef.current = next;
    setGesture(next);
  }

  function endGesture(pointerEvent: React.PointerEvent<HTMLElement>) {
    const state = gestureRef.current;
    gestureRef.current = null;
    setGesture(null);
    onConvertPreview?.(null);
    if (!state?.dragging) return;
    suppressClickRef.current = true;
    if (state.mode === "move" && state.convertDate && onConvertToAllDay) {
      onConvertToAllDay(state.event, { type: "to-all-day", startDate: state.convertDate }, {
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
      });
      return;
    }
    const draft = clampTimedDraft(state.event, state.draft);
    const applied = applyTimedDraft(state.event, draft);
    if (!applied.ok || applied.unchanged) return;
    onGestureCommit(state.event, draft, { x: pointerEvent.clientX, y: pointerEvent.clientY });
  }

  function cancelGesture() {
    gestureRef.current = null;
    setGesture(null);
    onConvertPreview?.(null);
  }

  function resolveCreatePoint(clientX: number, clientY: number, lockedDayIndex?: number) {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const dayIndex = lockedDayIndex ?? hitTestDayIndex(clientX - rect.left, rect.width, days.length);
    const minutesOnDay = clampMinutes(yToMinutes(clientY - rect.top, hourHeightPx), 0, MINUTES_PER_DAY);
    return { dayIndex, minutesOnDay };
  }

  function beginCreate(pointerEvent: React.PointerEvent<HTMLElement>) {
    if (!canCreate || pointerEvent.button !== 0) return;
    if (gestureRef.current || createRef.current) return;
    if (isExistingTimedEventTarget(pointerEvent.target)) return;
    const point = resolveCreatePoint(pointerEvent.clientX, pointerEvent.clientY);
    if (!point) return;
    const next: CreateGesture = {
      originX: pointerEvent.clientX,
      originY: pointerEvent.clientY,
      originDayIndex: point.dayIndex,
      originMinutes: point.minutesOnDay,
      currentMinutes: point.minutesOnDay,
      dragging: false,
    };
    createRef.current = next;
    setCreateGesture(next);
  }

  function trackCreate(pointerEvent: React.PointerEvent<HTMLElement>) {
    const state = createRef.current;
    if (!state) return;
    const dx = pointerEvent.clientX - state.originX;
    const dy = pointerEvent.clientY - state.originY;
    if (!state.dragging && !pointerExceedsDragThreshold(dx, dy)) return;
    const point = resolveCreatePoint(pointerEvent.clientX, pointerEvent.clientY, state.originDayIndex);
    if (!point) return;
    const next = { ...state, dragging: true, currentMinutes: point.minutesOnDay };
    createRef.current = next;
    setCreateGesture(next);
    if (!state.dragging) overlayRef.current?.setPointerCapture(pointerEvent.pointerId);
  }

  function endCreate() {
    const state = createRef.current;
    createRef.current = null;
    setCreateGesture(null);
    if (!state || !onCreateDraft) return;
    const date = calendarDateFromLocalDate(days[state.originDayIndex] ?? days[0]!);
    onCreateDraft(
      state.dragging
        ? timedDragDraft(date, state.originMinutes, state.currentMinutes)
        : timedClickDraft(date, state.originMinutes),
    );
  }

  function cancelCreate() {
    createRef.current = null;
    setCreateGesture(null);
  }

  function handleCreateKey(keyboardEvent: React.KeyboardEvent<HTMLElement>) {
    if (!canCreate || !onCreateDraft) return;
    const lastDay = Math.max(0, days.length - 1);
    if (keyboardEvent.key === "ArrowDown") {
      keyboardEvent.preventDefault();
      setFocusMinutes((current) => clampMinutes(current + SNAP_MINUTES, 0, MINUTES_PER_DAY - DEFAULT_TIMED_DURATION_MINUTES));
      return;
    }
    if (keyboardEvent.key === "ArrowUp") {
      keyboardEvent.preventDefault();
      setFocusMinutes((current) => clampMinutes(current - SNAP_MINUTES, 0, MINUTES_PER_DAY - DEFAULT_TIMED_DURATION_MINUTES));
      return;
    }
    if (keyboardEvent.key === "ArrowRight") {
      keyboardEvent.preventDefault();
      setFocusDayIndex((current) => Math.min(lastDay, current + 1));
      return;
    }
    if (keyboardEvent.key === "ArrowLeft") {
      keyboardEvent.preventDefault();
      setFocusDayIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
      keyboardEvent.preventDefault();
      const date = calendarDateFromLocalDate(days[focusDayIndex] ?? days[0]!);
      onCreateDraft(timedClickDraft(date, focusMinutes));
    }
  }

  function handleClick(event: DbCalendarEvent, mouseEvent: React.MouseEvent<HTMLElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onEventClick(event, { x: mouseEvent.clientX, y: mouseEvent.clientY });
  }

  const height = minutesToY(MINUTES_PER_DAY, hourHeightPx);
  const converting = Boolean(preview?.convertDate);
  const appliedPreview = preview && !converting ? applyTimedDraft(preview.event, preview.draft) : null;
  const previewTimeText = converting
    ? (locale === "ru" ? "Весь день" : "All day")
    : appliedPreview?.ok ? previewLabel(appliedPreview.time) : null;
  const previewSegments = preview && !converting ? weekRangeSegments(preview.previewStart, preview.previewEnd) : [];
  const createDate = days[createGesture?.originDayIndex ?? focusDayIndex] ?? days[0];
  const createPreviewDraft = createGesture?.dragging && createDate
    ? timedDragDraft(calendarDateFromLocalDate(createDate), createGesture.originMinutes, createGesture.currentMinutes)
    : null;
  const keyboardDraft = canCreate && days[focusDayIndex]
    ? timedClickDraft(calendarDateFromLocalDate(days[focusDayIndex]!), focusMinutes)
    : null;

  return (
    <div
      ref={overlayRef}
      data-testid="timed-grid-overlay"
      role={canCreate ? "grid" : undefined}
      tabIndex={canCreate ? 0 : undefined}
      aria-label={keyboardDraft ? formatCreateAriaLabel(keyboardDraft, locale) : undefined}
      className={`absolute inset-0 grid ${canCreate ? "cursor-cell" : ""}`}
      style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, height }}
      onPointerDown={beginCreate}
      onPointerMove={trackCreate}
      onPointerUp={endCreate}
      onPointerCancel={cancelCreate}
      onKeyDown={handleCreateKey}
    >
      {columns.map(({ dayStart, dayEvents, packById }, dayIndex) => (
        <div key={dayIndex} className="relative min-w-0" data-testid={`timed-day-column-${dayIndex}`}>
          {dayEvents.map((event) => {
            const interactive = canUpdateEvent(event) && canDragResizeTimedEvent(event, capabilities) && !pendingEventIds.has(event.id);
            const packing = packById.get(event.id);
            const live = preview?.event.id === event.id;
            const axis = eventAxisMinutes(event, dayStart);
            const segment = visibleSegment(axis.start, axis.end);
            if (!segment) return null;
            const columnCount = packing?.columnCount ?? 1;
            const column = packing?.column ?? 0;
            const widthPct = 100 / columnCount;
            const pending = pendingEventIds.has(event.id);
            const title = event.summary ?? (locale === "ru" ? "Событие" : "Event");
            return (
              <div
                key={event.id}
                data-testid={`timed-event-${event.id}`}
                data-interactive={interactive ? "true" : "false"}
                className={`absolute rounded text-left text-[0.625rem] leading-tight overflow-hidden ${
                  interactive ? "bg-accent/20 text-accent" : "bg-accent/10 text-accent/80"
                } ${pending || live ? "opacity-50" : ""}`}
                style={{
                  top: minutesToY(segment.top, hourHeightPx),
                  height: Math.max(minutesToY(segment.duration, hourHeightPx), 16),
                  left: `calc(${column * widthPct}% + 2px)`,
                  width: `calc(${widthPct}% - 4px)`,
                }}
              >
                <button
                  type="button"
                  aria-label={formatEventAriaLabel(event, locale)}
                  className={`absolute inset-0 truncate px-1 pt-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${interactive ? "cursor-grab" : "cursor-pointer"} ${live ? "cursor-grabbing" : ""}`}
                  onPointerDown={(pointerEvent) => {
                    pointerEvent.stopPropagation();
                    if (!interactive) return;
                    beginGesture(event, "move", pointerEvent);
                  }}
                  onClick={(mouseEvent) => handleClick(event, mouseEvent)}
                  {...pointerBind}
                >
                  {title}
                </button>
                {interactive ? (
                  <>
                    <div
                      data-testid={`timed-resize-start-${event.id}`}
                      aria-hidden="true"
                      className="absolute inset-x-0 top-0 z-10 h-2 cursor-ns-resize"
                      onPointerDown={(pointerEvent) => {
                        pointerEvent.preventDefault();
                        pointerEvent.stopPropagation();
                        beginGesture(event, "resize-start", pointerEvent);
                      }}
                      {...pointerBind}
                    />
                    <div
                      data-testid={`timed-resize-end-${event.id}`}
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-0 z-10 h-2 cursor-ns-resize"
                      onPointerDown={(pointerEvent) => {
                        pointerEvent.preventDefault();
                        pointerEvent.stopPropagation();
                        beginGesture(event, "resize-end", pointerEvent);
                      }}
                      {...pointerBind}
                    />
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
      {previewSegments.map((segment, index) => (
        <div
          key={`preview-${index}`}
          data-testid="timed-drag-preview"
          className="pointer-events-none absolute z-20 rounded bg-accent/40 text-[0.625rem] text-accent ring-1 ring-accent"
          style={{
            left: `${(segment.dayIndex / days.length) * 100}%`,
            width: `${100 / days.length}%`,
            top: minutesToY(segment.top, hourHeightPx),
            height: Math.max(minutesToY(segment.duration, hourHeightPx), 16),
          }}
        >
          <span className="block truncate px-1 pt-1">
            {preview?.event.summary}
            {previewTimeText ? <span className="ml-1 opacity-80">{previewTimeText}</span> : null}
          </span>
        </div>
      ))}
      {converting && preview ? (
        <div
          data-testid="timed-convert-preview"
          className="pointer-events-none absolute z-20 left-1 top-1 rounded bg-accent/40 px-1 py-0.5 text-[0.625rem] text-accent ring-1 ring-accent"
        >
          {preview.event.summary}
          {previewTimeText ? <span className="ml-1 opacity-80">{previewTimeText}</span> : null}
        </div>
      ) : null}
      {createPreviewDraft && createPreviewDraft.kind === "timed" ? (
        <div
          data-testid="timed-create-preview"
          className="pointer-events-none absolute z-20 rounded bg-accent/30 text-[0.625rem] text-accent ring-1 ring-accent"
          style={{
            left: `${((createGesture?.originDayIndex ?? 0) / days.length) * 100}%`,
            width: `${100 / days.length}%`,
            top: minutesToY(createPreviewDraft.startMinutes, hourHeightPx),
            height: Math.max(
              minutesToY(createPreviewDraft.endMinutes - createPreviewDraft.startMinutes, hourHeightPx),
              16,
            ),
          }}
        >
          <span className="block truncate px-1 pt-1">
            {formatTimedRangeLabel(createPreviewDraft.startMinutes, createPreviewDraft.endMinutes)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
