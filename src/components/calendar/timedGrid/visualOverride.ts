import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { applyTimedDraft, type TimedDraft } from "./timedEventMutation";
import type { TimedVisualOverride } from "./TimedGridOverlay";

export function overrideFromTimedDraft(event: DbCalendarEvent, draft: TimedDraft): TimedVisualOverride | null {
  const applied = applyTimedDraft(event, draft);
  if (!applied.ok) return null;
  if (applied.time.kind === "timed-zoned") {
    return { start_time: applied.time.start.instant, end_time: applied.time.end.instant };
  }
  if (applied.time.kind === "floating") {
    return {
      start_time: event.start_time + draft.deltaStartMinutes * 60,
      end_time: event.end_time + draft.deltaEndMinutes * 60,
    };
  }
  return null;
}
