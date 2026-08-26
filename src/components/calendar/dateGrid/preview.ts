import type { CalendarEventTime } from "@/services/calendar/domain";
import { previewLabel } from "../timedGrid/timedEventMutation";

export function dateGridPreviewLabel(time: CalendarEventTime, locale: "ru" | "en"): string {
  if (time.kind === "all-day") return locale === "ru" ? "Весь день" : "All day";
  return previewLabel(time);
}

export function formatEventAriaLabel(
  event: { summary: string | null; is_all_day: number; time_kind: string | null; start_time: number; end_time: number },
  locale: "ru" | "en",
): string {
  const title = event.summary ?? (locale === "ru" ? "Событие" : "Event");
  if (event.is_all_day === 1 || event.time_kind === "all-day") {
    return `${title}, ${locale === "ru" ? "весь день" : "all day"}`;
  }
  const start = new Date(event.start_time * 1000);
  const end = new Date(event.end_time * 1000);
  const time = `${pad(start.getHours())}:${pad(start.getMinutes())}–${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return `${title}, ${time}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
