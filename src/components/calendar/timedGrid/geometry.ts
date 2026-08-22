import { DRAG_THRESHOLD_PX, MINUTES_PER_DAY, MIN_DURATION_MINUTES, SNAP_MINUTES } from "./constants";

export type TimedGestureMode = "move" | "resize-start" | "resize-end";

export function snapMinutes(minutes: number, snap = SNAP_MINUTES): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.round(minutes / snap) * snap;
}

export function clampMinutes(minutes: number, min = 0, max = MINUTES_PER_DAY): number {
  return Math.min(max, Math.max(min, minutes));
}

export function minutesToY(minutes: number, hourHeightPx: number): number {
  return (minutes / 60) * hourHeightPx;
}

export function yToMinutes(y: number, hourHeightPx: number): number {
  if (hourHeightPx <= 0) return 0;
  return (y / hourHeightPx) * 60;
}

export function weekMinutes(dayIndex: number, minutesOnDay: number): number {
  return dayIndex * MINUTES_PER_DAY + minutesOnDay;
}

export function splitWeekMinutes(total: number): { dayIndex: number; minutesOnDay: number } {
  const normalized = Math.max(0, total);
  const dayIndex = Math.floor(normalized / MINUTES_PER_DAY);
  return { dayIndex, minutesOnDay: normalized - dayIndex * MINUTES_PER_DAY };
}

export function pointerExceedsDragThreshold(dx: number, dy: number, thresholdPx = DRAG_THRESHOLD_PX): boolean {
  return (dx * dx) + (dy * dy) >= thresholdPx * thresholdPx;
}

export function clampDurationMinutes(start: number, end: number, minDuration = MIN_DURATION_MINUTES): { start: number; end: number } {
  if (end - start >= minDuration) return { start, end };
  return { start, end: start + minDuration };
}

export function eventAxisMinutes(event: { start_time: number; end_time: number }, dayStartUnix: number): { start: number; end: number } {
  return {
    start: (event.start_time - dayStartUnix) / 60,
    end: (event.end_time - dayStartUnix) / 60,
  };
}

export function visibleSegment(startMinutes: number, endMinutes: number): { top: number; duration: number } | null {
  const start = Math.max(0, startMinutes);
  const end = Math.min(MINUTES_PER_DAY, endMinutes);
  if (end <= start) return null;
  return { top: start, duration: end - start };
}

export function hitTestDayIndex(x: number, overlayWidth: number, dayCount: number): number {
  if (dayCount <= 1) return 0;
  const colWidth = overlayWidth / dayCount;
  if (colWidth <= 0) return 0;
  return Math.min(dayCount - 1, Math.max(0, Math.floor(x / colWidth)));
}

export function weekRangeSegments(
  startWeekMinutes: number,
  endWeekMinutes: number,
): { dayIndex: number; top: number; duration: number }[] {
  const segments: { dayIndex: number; top: number; duration: number }[] = [];
  let cursor = startWeekMinutes;
  const end = Math.max(startWeekMinutes, endWeekMinutes);
  while (cursor < end) {
    const { dayIndex, minutesOnDay } = splitWeekMinutes(cursor);
    const consume = Math.min(end - cursor, MINUTES_PER_DAY - minutesOnDay);
    if (consume <= 0) break;
    const visible = visibleSegment(minutesOnDay, minutesOnDay + consume);
    if (visible) segments.push({ dayIndex, top: visible.top, duration: visible.duration });
    cursor += consume;
  }
  return segments;
}
