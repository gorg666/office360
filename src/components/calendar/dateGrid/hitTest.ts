import { calendarDateFromLocalDate, type CalendarDate } from "@/services/calendar/domain";
import { SNAP_MINUTES } from "../timedGrid/constants";
import { clampMinutes, hitTestDayIndex, snapMinutes, yToMinutes } from "../timedGrid/geometry";

export function hitTestCalendarDate(clientX: number, clientY: number): CalendarDate | null {
  const cells = document.querySelectorAll<HTMLElement>("[data-calendar-date]");
  for (const cell of cells) {
    const rect = cell.getBoundingClientRect();
    if (clientX >= rect.left && clientX < rect.right && clientY >= rect.top && clientY < rect.bottom) {
      return cell.dataset.calendarDate ?? null;
    }
  }
  return null;
}

export function hitTestAllDayDrop(clientX: number, clientY: number): CalendarDate | null {
  const zones = document.querySelectorAll<HTMLElement>("[data-allday-drop]");
  for (const zone of zones) {
    const rect = zone.getBoundingClientRect();
    if (clientX >= rect.left && clientX < rect.right && clientY >= rect.top && clientY < rect.bottom) {
      return zone.dataset.calendarDate ?? zone.dataset.alldayDrop ?? null;
    }
  }
  return null;
}

export function hitTestTimedOverlay(
  clientX: number,
  clientY: number,
  overlay: Element | null,
  hourHeightPx: number,
  days: Date[],
): { dayIndex: number; date: CalendarDate; minutesOnDay: number } | null {
  if (!overlay || days.length === 0) return null;
  const rect = overlay.getBoundingClientRect();
  if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) {
    return null;
  }
  const dayIndex = hitTestDayIndex(clientX - rect.left, rect.width, days.length);
  const minutesOnDay = clampMinutes(snapMinutes(yToMinutes(clientY - rect.top, hourHeightPx), SNAP_MINUTES));
  const day = days[dayIndex];
  if (!day) return null;
  return { dayIndex, date: calendarDateFromLocalDate(day), minutesOnDay };
}
