export class CalendarOfflineError extends Error {
  readonly code = "calendar-offline";
  constructor() {
    super("Calendar provider operation is unavailable while offline");
    this.name = "CalendarOfflineError";
  }
}

export function isCalendarOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}
