import type { CalendarDate } from "@/services/calendar/domain";
import type { GridCreateDraft } from "./draft";

export function formatClockMinutes(minutes: number): string {
  const safe = Math.max(0, minutes);
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${pad(hours)}:${pad(rest)}`;
}

export function formatTimedRangeLabel(startMinutes: number, endMinutes: number): string {
  return `${formatClockMinutes(startMinutes)}–${formatClockMinutes(endMinutes)}`;
}

export function formatCreateAriaLabel(draft: GridCreateDraft, locale: "ru" | "en"): string {
  if (draft.kind === "all-day") {
    const date = formatLongDate(draft.startDate, locale);
    return locale === "ru" ? `Создать событие ${date}` : `Create event on ${date}`;
  }
  const date = formatLongDate(draft.date, locale);
  const time = formatClockMinutes(draft.startMinutes);
  return locale === "ru"
    ? `Создать событие ${date} в ${time}`
    : `Create event on ${date} at ${time}`;
}

function formatLongDate(date: CalendarDate, locale: "ru" | "en"): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "long",
  }).format(new Date(year!, month! - 1, day!));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
