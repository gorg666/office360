import type { DbCalendar } from "@/services/db/calendars";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { calendarMutationService, type CalendarWriteResult } from "@/services/calendar/calendarMutationService";
import type { RecurrenceWriteScope } from "@/services/calendar/domain";
import type { CalendarEventData } from "@/services/calendar/types";
import { timedMutationTarget } from "../timedGrid/commitTimedGridMutation";
import { applyDateGridDraft, type DateGridDraft } from "./dateShift";

export async function commitDateGridMutation(options: {
  accountId: string;
  event: DbCalendarEvent;
  calendars: readonly DbCalendar[];
  draft: DateGridDraft;
  scope?: RecurrenceWriteScope;
}): Promise<CalendarWriteResult<CalendarEventData>> {
  const applied = applyDateGridDraft(options.event, options.draft);
  if (!applied.ok) {
    return { status: "unsupported", message: "Это изменение даты недопустимо." };
  }
  if (applied.unchanged) {
    return { status: "success", value: {} as CalendarEventData };
  }
  return calendarMutationService.update(
    timedMutationTarget(options.accountId, options.event, options.calendars, options.scope),
    applied.input,
  );
}
