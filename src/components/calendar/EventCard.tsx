import type { MouseEventHandler, PointerEventHandler } from "react";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { useUIStore } from "@/stores/uiStore";
import { useCalendarColors } from "./calendarColorContext";

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
  selected?: boolean;
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
  selected,
}: EventCardProps) {
  const locale = useUIStore((state) => state.locale);
  const colorFor = useCalendarColors();
  const colors = colorFor(event);

  const untitled = locale === "ru" ? "Событие" : "Event";
  const untitledLong = locale === "ru" ? "(Без названия)" : "(No title)";
  const startDate = new Date(event.start_time * 1000);
  const timeStr = event.is_all_day
    ? (locale === "ru" ? "Весь день" : "All day")
    : startDate.toLocaleTimeString(locale === "ru" ? "ru-RU" : "en-US", { hour: "numeric", minute: "2-digit" });

  if (compact) {
    return (
      <button
        type="button"
        draggable={false}
        disabled={disabled}
        aria-label={ariaLabel ?? event.summary ?? untitled}
        aria-pressed={selected}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className={`focus-ring t-fast relative w-full truncate rounded-tight border-l-[3px]
          py-0.5 pr-1 pl-1.5 text-left text-caption font-medium
          ${interactive ? "cursor-grab" : "cursor-pointer"}
          ${dragging ? "cursor-grabbing opacity-50" : ""}
          ${selected ? "ring-2 ring-focus-ring ring-offset-1" : ""}`}
        style={{
          backgroundColor: colors.fill,
          borderLeftColor: colors.marker,
          color: colors.text,
        }}
        title={event.summary ?? untitled}
      >
        {event.summary ?? untitled}
      </button>
    );
  }

  return (
    <button
      type="button"
      draggable={false}
      disabled={disabled}
      aria-label={ariaLabel ?? event.summary ?? untitled}
      aria-pressed={selected}
      onClick={onClick}
      className={`focus-ring t-fast w-full rounded-control border border-l-[3px] px-3 py-2 text-left
        hover:brightness-[0.98] dark:hover:brightness-110
        ${selected ? "ring-2 ring-focus-ring ring-offset-1" : ""}`}
      style={{
        backgroundColor: colors.fill,
        borderColor: colors.border,
        borderLeftColor: colors.marker,
      }}
    >
      <div className="min-w-0">
        <div className="truncate text-meta font-semibold" style={{ color: colors.text }}>
          {event.summary ?? untitledLong}
        </div>
        <div className="mt-0.5 truncate text-caption opacity-80" style={{ color: colors.text }}>
          {timeStr}
          {event.location && ` · ${event.location}`}
        </div>
      </div>
    </button>
  );
}
