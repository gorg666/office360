import type {
  AvailabilityInterval,
  AvailabilityState,
  BusyInterval,
  BusyType,
  ParticipantAvailability,
} from "./types";

/** Severity order used whenever two intervals cover the same instant: busy > tentative > free. */
const SEVERITY: Record<BusyType, number> = { tentative: 1, busy: 2 };

function moreSevere(a: BusyType, b: BusyType): BusyType {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

/** Clip to `[range.start, range.end)`. Returns null when nothing of the interval remains. */
export function clipBusyInterval(
  interval: BusyInterval,
  range: AvailabilityInterval,
): BusyInterval | null {
  const start = Math.max(interval.start, range.start);
  const end = Math.min(interval.end, range.end);
  if (end <= start) return null;
  return { start, end, busyType: interval.busyType };
}

/**
 * Normalize raw busy intervals into a deterministic, non-overlapping, ascending set.
 *
 * Rules:
 * - zero-length and inverted intervals are dropped;
 * - overlapping intervals of the same type merge;
 * - where types overlap, the more severe type wins for the overlapping portion only;
 * - adjacent intervals (`a.end === b.start`) merge when the type matches, and stay separate
 *   when it does not, so a busy hour followed by a tentative hour is never flattened.
 */
export function mergeBusyIntervals(
  intervals: readonly BusyInterval[],
  range?: AvailabilityInterval,
): BusyInterval[] {
  const usable: BusyInterval[] = [];
  for (const interval of intervals) {
    if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end)) continue;
    const clipped = range ? clipBusyInterval(interval, range) : interval;
    if (!clipped || clipped.end <= clipped.start) continue;
    usable.push(clipped);
  }
  if (usable.length === 0) return [];

  // Sweep the distinct boundaries and take the most severe cover of each elementary segment.
  const boundaries = [...new Set(usable.flatMap((interval) => [interval.start, interval.end]))]
    .sort((a, b) => a - b);

  const segments: BusyInterval[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]!;
    const end = boundaries[index + 1]!;
    let busyType: BusyType | null = null;
    for (const interval of usable) {
      if (interval.start <= start && interval.end >= end) {
        busyType = busyType === null ? interval.busyType : moreSevere(busyType, interval.busyType);
      }
    }
    if (busyType !== null) segments.push({ start, end, busyType });
  }

  const merged: BusyInterval[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.end === segment.start && previous.busyType === segment.busyType) {
      previous.end = segment.end;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

/**
 * Complement of the busy set inside `range`. Pure interval arithmetic: callers are
 * responsible for checking reliability before presenting the result as genuinely free.
 */
export function invertBusyIntervals(
  range: AvailabilityInterval,
  busy: readonly BusyInterval[],
): AvailabilityInterval[] {
  if (range.end <= range.start) return [];
  const merged = mergeBusyIntervals(busy, range);
  const free: AvailabilityInterval[] = [];
  let cursor = range.start;
  for (const interval of merged) {
    if (interval.start > cursor) free.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < range.end) free.push({ start: cursor, end: range.end });
  return free;
}

/**
 * The safe accessor. An instant is only `free` when nothing covers it AND the answer is
 * fully reliable; otherwise missing data reads as `unknown`, never as free.
 */
export function availabilityStateAt(
  availability: ParticipantAvailability,
  instant: number,
): AvailabilityState {
  const covering = availability.busy.filter(
    (interval) => interval.start <= instant && instant < interval.end,
  );
  if (covering.length > 0) {
    return covering.some((interval) => interval.busyType === "busy") ? "busy" : "tentative";
  }
  return availability.reliability === "known" ? "free" : "unknown";
}

/** Same rule as {@link availabilityStateAt}, applied to a whole half-open interval. */
export function availabilityStateForInterval(
  availability: ParticipantAvailability,
  interval: AvailabilityInterval,
): AvailabilityState {
  if (interval.end <= interval.start) return "unknown";
  const overlapping = availability.busy.filter(
    (busy) => busy.start < interval.end && busy.end > interval.start,
  );
  if (overlapping.some((busy) => busy.busyType === "busy")) return "busy";
  if (overlapping.length > 0) return "tentative";
  return availability.reliability === "known" ? "free" : "unknown";
}

/** True when an absence of intervals may be presented to a user as genuine free time. */
export function canReportFree(availability: ParticipantAvailability): boolean {
  return availability.reliability === "known";
}
