import {
  accessForCalendar,
  markMissingProviderCalendarsRemoved,
  upsertCalendar,
  type DbCalendar,
} from "@/services/db/calendars";
import { getCalendarProvider } from "./providerFactory";
import type { CalendarProvider } from "./types";

export async function refreshCalendarAccess(
  accountId: string,
  provider?: CalendarProvider,
): Promise<readonly string[]> {
  const resolvedProvider = provider ?? (await getCalendarProvider(accountId));
  const observedAt = Math.floor(Date.now() / 1000);
  const remoteCalendars = await resolvedProvider.listCalendars();
  for (const calendar of remoteCalendars) {
    await upsertCalendar({
      accountId,
      provider: resolvedProvider.type,
      remoteId: calendar.remoteId,
      displayName: calendar.displayName,
      color: calendar.color,
      isPrimary: calendar.isPrimary,
      access: calendar.access,
      observedAt,
    });
  }
  await markMissingProviderCalendarsRemoved(
    accountId,
    resolvedProvider.type,
    remoteCalendars.map((calendar) => calendar.remoteId),
  );
  return remoteCalendars.map((calendar) => calendar.remoteId);
}

export function eventReadableCalendars(calendars: readonly DbCalendar[]): DbCalendar[] {
  return calendars.filter((calendar) => {
    const permissions = accessForCalendar(calendar).permissions;
    return permissions.canRead && permissions.canSeeEventDetails;
  });
}
