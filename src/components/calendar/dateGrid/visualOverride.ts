import type { CalendarEventTime } from "@/services/calendar/domain";
import { calendarDateToUnixSeconds, wallDateTimeToNaiveDate } from "@/services/calendar/domain";
import type { TimedVisualOverride } from "../timedGrid/TimedGridOverlay";

export function overrideFromDateGrid(time: CalendarEventTime): TimedVisualOverride {
  if (time.kind === "all-day") {
    return {
      start_time: calendarDateToUnixSeconds(time.startDate),
      end_time: calendarDateToUnixSeconds(time.endDateExclusive),
      time_kind: "all-day",
      is_all_day: 1,
      end_date_exclusive: time.endDateExclusive,
    };
  }
  if (time.kind === "floating") {
    return {
      start_time: Math.floor(wallDateTimeToNaiveDate(time.start).getTime() / 1000),
      end_time: Math.floor(wallDateTimeToNaiveDate(time.end).getTime() / 1000),
      time_kind: "floating",
      is_all_day: 0,
      end_date_exclusive: null,
    };
  }
  return {
    start_time: time.start.instant,
    end_time: time.end.instant,
    time_kind: "timed-zoned",
    is_all_day: 0,
    end_date_exclusive: null,
  };
}
