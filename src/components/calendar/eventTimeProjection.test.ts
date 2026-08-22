import { eventOccursOnDate } from "./eventTimeProjection";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";

const allDay = {
  start_time: Date.UTC(2026, 2, 15) / 1000,
  end_time: Date.UTC(2026, 2, 16) / 1000,
  is_all_day: 1,
  time_kind: "all-day",
  end_date_exclusive: "2026-03-16",
} as DbCalendarEvent;

describe("calendar UI time projection", () => {
  it("uses exclusive calendar dates for all-day membership", () => {
    expect(eventOccursOnDate(allDay, new Date(2026, 2, 15, 12))).toBe(true);
    expect(eventOccursOnDate(allDay, new Date(2026, 2, 16, 0))).toBe(false);
  });
});
