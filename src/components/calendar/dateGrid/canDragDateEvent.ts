import type { CalendarProviderCapabilities } from "@/services/calendar/domain";
import { canMutateRecurring, classifyRecurringEditTarget } from "../recurrence/recurrenceEditScope";

/** Capability gate for Month / all-day move and timed ↔ all-day conversion. */
export function canDragDateEvent(
  event: {
    status: string;
    is_recurrence_master: number;
    occurrence_key: string | null;
    series_uid: string | null;
    uid: string | null;
  },
  capabilities: CalendarProviderCapabilities | null,
): boolean {
  if (event.status === "cancelled") return false;
  if (!capabilities || capabilities.events.update !== "remote") return false;
  return canMutateRecurring(capabilities, "update", classifyRecurringEditTarget(event));
}
