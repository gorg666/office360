import type { CalendarProviderCapabilities } from "@/services/calendar/domain";

export function canCreateCalendarEvent(
  capabilities: CalendarProviderCapabilities | null | undefined,
): boolean {
  return capabilities?.events.create === "remote";
}
