import type { DbCalendar } from "@/services/db/calendars";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { calendarMutationService, type CalendarWriteResult } from "@/services/calendar/calendarMutationService";
import type { RecurrenceWriteScope } from "@/services/calendar/domain";
import type { CalendarEventData } from "@/services/calendar/types";
import { classifyRecurringEditTarget } from "../recurrence/recurrenceEditScope";
import { applyTimedDraft, type TimedDraft } from "./timedEventMutation";

export function timedMutationTarget(
  accountId: string,
  event: DbCalendarEvent,
  calendars: readonly DbCalendar[],
  scope?: RecurrenceWriteScope,
) {
  const calendar = calendars.find((item) => item.id === event.calendar_id);
  const editTarget = classifyRecurringEditTarget(event);
  const recurring = editTarget.kind !== "plain";
  return {
    accountId,
    calendarRemoteId: calendar?.remote_id ?? "primary",
    remoteEventId: event.remote_event_id ?? event.google_event_id,
    etag: event.etag ?? undefined,
    baseSequence: event.sequence,
    isRecurring: recurring,
    recurrenceScope: scope,
    seriesUid: editTarget.seriesUid,
    occurrenceKey: scope === "single" ? editTarget.occurrenceKey : undefined,
  };
}

export async function commitTimedGridMutation(options: {
  accountId: string;
  event: DbCalendarEvent;
  calendars: readonly DbCalendar[];
  draft: TimedDraft;
  scope?: RecurrenceWriteScope;
}): Promise<CalendarWriteResult<CalendarEventData>> {
  const applied = applyTimedDraft(options.event, options.draft);
  if (!applied.ok) {
    return { status: "unsupported", message: "Это изменение времени недопустимо." };
  }
  if (applied.unchanged) {
    return { status: "success", value: {} as CalendarEventData };
  }
  return calendarMutationService.update(
    timedMutationTarget(options.accountId, options.event, options.calendars, options.scope),
    applied.input,
  );
}
