import { useRef, useState } from "react";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { CalendarDate } from "@/services/calendar/domain";
import { calendarDateFromLocalDate } from "@/services/calendar/domain";
import type { CalendarProviderCapabilities } from "@/services/calendar/domain";
import { DRAG_THRESHOLD_PX } from "../timedGrid/constants";
import { pointerExceedsDragThreshold } from "../timedGrid/geometry";
import { canDragDateEvent } from "./canDragDateEvent";
import { applyDateGridDraft, calendarDateDiffDays, type DateGridDraft } from "./dateShift";
import { dateGridPreviewLabel, formatEventAriaLabel } from "./preview";
import { hitTestAllDayDrop, hitTestTimedOverlay } from "./hitTest";
import { allDayClickDraft, canCreateCalendarEvent, formatCreateAriaLabel, type GridCreateDraft } from "../createSelection";

interface AllDayLaneProps {
  days: Date[];
  capabilities: CalendarProviderCapabilities | null;
  pendingEventIds: ReadonlySet<string>;
  locale: "ru" | "en";
  hourHeightPx: number;
  onEventClick: (event: DbCalendarEvent, anchor: { x: number; y: number }) => void;
  onDateCommit: (event: DbCalendarEvent, draft: DateGridDraft, anchor: { x: number; y: number }) => void;
  eventsByDay: ReadonlyMap<string, DbCalendarEvent[]>;
  conversionHighlight?: CalendarDate | null;
  onCreateDraft?: (draft: GridCreateDraft) => void;
  canUpdateEvent?: (event: DbCalendarEvent) => boolean;
}

interface AllDayGesture {
  event: DbCalendarEvent;
  originDate: CalendarDate;
  originX: number;
  originY: number;
  dragging: boolean;
  draft: DateGridDraft | null;
}

export function AllDayLane({
  days,
  capabilities,
  pendingEventIds,
  locale,
  hourHeightPx,
  onEventClick,
  onDateCommit,
  eventsByDay,
  conversionHighlight = null,
  onCreateDraft,
  canUpdateEvent = () => true,
}: AllDayLaneProps) {
  const suppressClickRef = useRef(false);
  const gestureRef = useRef<AllDayGesture | null>(null);
  const [gesture, setGesture] = useState<AllDayGesture | null>(null);

  function resolveDraft(state: AllDayGesture, clientX: number, clientY: number): DateGridDraft | null {
    const allDayDate = hitTestAllDayDrop(clientX, clientY);
    if (allDayDate) {
      const deltaDays = calendarDateDiffDays(state.originDate, allDayDate);
      return { type: "shift", deltaDays };
    }
    const overlay = document.querySelector("[data-testid='timed-grid-overlay']");
    const timed = hitTestTimedOverlay(clientX, clientY, overlay, hourHeightPx, days);
    if (timed) {
      return { type: "to-timed", startDate: timed.date, startMinutesFromMidnight: timed.minutesOnDay };
    }
    return null;
  }

  function begin(event: DbCalendarEvent, originDate: CalendarDate, pointerEvent: React.PointerEvent<HTMLElement>) {
    if (pointerEvent.button !== 0) return;
    const next: AllDayGesture = {
      event,
      originDate,
      originX: pointerEvent.clientX,
      originY: pointerEvent.clientY,
      dragging: false,
      draft: null,
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
    const draft = resolveDraft(state, pointerEvent.clientX, pointerEvent.clientY);
    const next = { ...state, dragging: true, draft };
    gestureRef.current = next;
    setGesture(next);
  }

  function end(pointerEvent: React.PointerEvent<HTMLElement>) {
    const state = gestureRef.current;
    gestureRef.current = null;
    setGesture(null);
    if (!state?.dragging || !state.draft) return;
    suppressClickRef.current = true;
    const applied = applyDateGridDraft(state.event, state.draft);
    if (!applied.ok || applied.unchanged) return;
    onDateCommit(state.event, state.draft, { x: pointerEvent.clientX, y: pointerEvent.clientY });
  }

  function cancel() {
    gestureRef.current = null;
    setGesture(null);
  }

  const preview = gesture?.dragging && gesture.draft ? applyDateGridDraft(gesture.event, gesture.draft) : null;
  const previewText = preview?.ok ? dateGridPreviewLabel(preview.time, locale) : null;
  const previewDate = gesture?.draft?.type === "shift"
    ? null
    : gesture?.draft?.type === "to-timed"
      ? gesture.draft.startDate
      : gesture?.draft?.type === "to-all-day"
        ? gesture.draft.startDate
        : null;
  const previewShiftDate = gesture?.draft?.type === "shift" && gesture.draft.deltaDays !== 0 && preview?.ok && preview.time.kind === "all-day"
    ? preview.time.startDate
    : previewDate;
  const canCreate = Boolean(onCreateDraft) && canCreateCalendarEvent(capabilities);

  function handleEmptyCellClick(date: CalendarDate, mouseEvent: React.MouseEvent<HTMLElement>) {
    if (!canCreate || !onCreateDraft) return;
    if (mouseEvent.target instanceof Element && mouseEvent.target.closest("[data-testid^='allday-event-']")) return;
    onCreateDraft(allDayClickDraft(date));
  }

  return (
    <div
      className="grid border-b border-border-primary shrink-0"
      style={{ gridTemplateColumns: `60px repeat(${days.length}, minmax(0, 1fr))` }}
      data-testid="allday-lane"
    >
      <div className="border-r border-border-secondary px-1 py-1 text-[0.625rem] text-text-tertiary">
        {locale === "ru" ? "весь день" : "all-day"}
      </div>
      {days.map((day, i) => {
        const date = calendarDateFromLocalDate(day);
        const allDay = eventsByDay.get(date) ?? [];
        const showGhost = (previewShiftDate === date && gesture)
          || conversionHighlight === date;
        return (
          <div
            key={i}
            data-calendar-date={date}
            data-allday-drop={date}
            data-testid={`allday-drop-${date}`}
            className={`border-r border-border-secondary px-1 py-1 space-y-0.5 ${showGhost ? "bg-accent/10" : ""} ${canCreate ? "cursor-cell" : ""}`}
            onClick={(mouseEvent) => handleEmptyCellClick(date, mouseEvent)}
          >
            {allDay.map((event) => {
              const interactive = canUpdateEvent(event) && canDragDateEvent(event, capabilities) && !pendingEventIds.has(event.id);
              const live = gesture?.event.id === event.id && gesture.dragging;
              const title = event.summary ?? (locale === "ru" ? "Событие" : "Event");
              return (
                <button
                  key={event.id}
                  type="button"
                  draggable={false}
                  data-testid={`allday-event-${event.id}`}
                  data-interactive={interactive ? "true" : "false"}
                  aria-label={formatEventAriaLabel(event, locale)}
                  disabled={pendingEventIds.has(event.id)}
                  className={`w-full text-left text-[0.625rem] px-1 py-0.5 rounded bg-accent/10 text-accent truncate hover:bg-accent/20 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                    interactive ? "cursor-grab" : "cursor-pointer"
                  } ${live ? "opacity-50 cursor-grabbing" : ""}`}
                  onPointerDown={(pointerEvent) => {
                    if (!interactive) return;
                    begin(event, date, pointerEvent);
                  }}
                  onPointerMove={track}
                  onPointerUp={end}
                  onPointerCancel={cancel}
                  onClick={(mouseEvent) => {
                    mouseEvent.stopPropagation();
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    onEventClick(event, { x: mouseEvent.clientX, y: mouseEvent.clientY });
                  }}
                >
                  {title}
                </button>
              );
            })}
            {showGhost ? (
              <div
                data-testid="allday-drag-preview"
                className="pointer-events-none text-[0.625rem] px-1 py-0.5 rounded bg-accent/40 text-accent ring-1 ring-accent truncate"
              >
                {gesture?.event.summary}
                {previewText || (conversionHighlight === date ? (locale === "ru" ? "Весь день" : "All day") : null)
                  ? (
                    <span className="ml-1 opacity-80">
                      {previewText ?? (locale === "ru" ? "Весь день" : "All day")}
                    </span>
                  )
                  : null}
              </div>
            ) : null}
            {canCreate ? (
              <button
                type="button"
                data-testid={`allday-create-${date}`}
                className="sr-only"
                aria-label={formatCreateAriaLabel(allDayClickDraft(date), locale)}
                onClick={(mouseEvent) => {
                  mouseEvent.stopPropagation();
                  onCreateDraft?.(allDayClickDraft(date));
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
