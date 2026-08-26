import type { CalendarProviderCapabilities } from "@/services/calendar/domain";
import { canMutateRecurring, classifyRecurringEditTarget } from "../recurrence/recurrenceEditScope";

export function canDragResizeTimedEvent(
  event: {
    is_all_day: number;
    status: string;
    is_recurrence_master: number;
    occurrence_key: string | null;
    series_uid: string | null;
    uid: string | null;
    time_kind: "timed-zoned" | "floating" | "all-day" | null;
  },
  capabilities: CalendarProviderCapabilities | null,
): boolean {
  if (event.is_all_day === 1 || event.time_kind === "all-day") return false;
  if (event.status === "cancelled") return false;
  if (!capabilities || capabilities.events.update !== "remote") return false;
  return canMutateRecurring(capabilities, "update", classifyRecurringEditTarget(event));
}
