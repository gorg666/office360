import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { CalendarDate } from "@/services/calendar/domain";
import { EventCard } from "./EventCard";
import { formatEventAriaLabel } from "./dateGrid";

interface MonthOverflowPopoverProps {
  date: CalendarDate;
  events: DbCalendarEvent[];
  anchor: DOMRect;
  locale: "en" | "ru";
  onClose: () => void;
  onEventClick: (event: DbCalendarEvent, anchor: { x: number; y: number }) => void;
}

export function MonthOverflowPopover({
  date,
  events,
  anchor,
  locale,
  onClose,
  onEventClick,
}: MonthOverflowPopoverProps) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const width = 240;
  const left = Math.max(8, Math.min(anchor.left, viewportWidth - width - 8));
  const top = Math.max(8, Math.min(anchor.bottom + 4, viewportHeight - 280));

  return createPortal(
    <section
      ref={panelRef}
      role="dialog"
      aria-label={locale === "ru" ? `События ${date}` : `Events ${date}`}
      data-testid="month-overflow-popover"
      className="fixed z-50 max-h-64 w-60 overflow-y-auto rounded-lg border border-border-primary bg-bg-primary p-2 shadow-xl"
      style={{ left, top }}
      onClick={(mouseEvent) => mouseEvent.stopPropagation()}
    >
      <div className="space-y-0.5">
        {events.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            compact
            ariaLabel={formatEventAriaLabel(event, locale)}
            onClick={(mouseEvent) => {
              mouseEvent.stopPropagation();
              onEventClick(event, { x: mouseEvent.clientX, y: mouseEvent.clientY });
              onClose();
            }}
          />
        ))}
      </div>
    </section>,
    document.body,
  );
}
