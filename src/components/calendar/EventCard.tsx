import type { MouseEventHandler, PointerEventHandler } from "react";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";

interface EventCardProps {
  event: DbCalendarEvent;
  compact?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  onPointerMove?: PointerEventHandler<HTMLButtonElement>;
  onPointerUp?: PointerEventHandler<HTMLButtonElement>;
  onPointerCancel?: PointerEventHandler<HTMLButtonElement>;
  ariaLabel?: string;
  interactive?: boolean;
  dragging?: boolean;
  disabled?: boolean;
}

export function EventCard({
  event,
  compact,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  ariaLabel,
  interactive,
  dragging,
  disabled,
}: EventCardProps) {
  const startDate = new Date(event.start_time * 1000);
  const timeStr = event.is_all_day
    ? "All day"
    : startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

  if (compact) {
    return (
      <button
        type="button"
        draggable={false}
        disabled={disabled}
        aria-label={ariaLabel ?? event.summary ?? "Event"}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className={`w-full text-left text-[0.625rem] px-1 py-0.5 rounded bg-accent/10 text-accent truncate hover:bg-accent/20 transition-colors ${focus} ${
          interactive ? "cursor-grab" : "cursor-pointer"
        } ${dragging ? "opacity-50 cursor-grabbing" : ""}`}
        title={event.summary ?? "Event"}
      >
        {event.summary ?? "Event"}
      </button>
    );
  }

  return (
    <button
      type="button"
      draggable={false}
      disabled={disabled}
      aria-label={ariaLabel ?? event.summary ?? "Event"}
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-md border border-border-secondary hover:bg-bg-hover transition-colors ${focus}`}
    >
      <div className="flex items-start gap-2">
        <div className="w-1 h-full min-h-[24px] rounded-full bg-accent shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary truncate">
            {event.summary ?? "(No title)"}
          </div>
          <div className="text-xs text-text-tertiary mt-0.5">
            {timeStr}
            {event.location && ` · ${event.location}`}
          </div>
        </div>
      </div>
    </button>
  );
}
