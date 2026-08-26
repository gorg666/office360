import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { CalendarEventTime, WallDateTime } from "@/services/calendar/domain";
import {
  addWallSeconds,
  formatWallDateTime,
  instantSecondsToWallDateTime,
  parseWallDateTime,
  zonedWallDateTimeToInstant,
} from "@/services/calendar/domain";
import type { UpdateEventInput } from "@/services/calendar/types";
import { MIN_DURATION_MINUTES, SNAP_MINUTES } from "./constants";
import { snapMinutes } from "./geometry";
import type { TimedGestureMode } from "./geometry";

export interface TimedDraft {
  mode: TimedGestureMode;
  /** Snapped wall-clock minutes added to DTSTART. */
  deltaStartMinutes: number;
  /** Snapped wall-clock minutes added to DTEND. */
  deltaEndMinutes: number;
}

export type TimedDraftApplyResult =
  | { ok: true; input: UpdateEventInput; time: CalendarEventTime; unchanged: boolean }
  | { ok: false; reason: "invalid-duration" | "all-day" };

export function parseStoredWallDateTime(value: string): WallDateTime {
  const compact = value.replaceAll("-", "").replaceAll(":", "").replace(/\.\d+$/, "");
  const match = /^(\d{8}T\d{6})$/.exec(compact);
  if (match) return parseWallDateTime(match[1]!);
  return parseWallDateTime(compact.length === 15 ? `${compact}00` : compact);
}

export function eventWallRange(event: DbCalendarEvent): { start: WallDateTime; end: WallDateTime } {
  const tzid = event.tzid ?? "UTC";
  const start = event.wall_start
    ? parseStoredWallDateTime(event.wall_start)
    : unixToFallbackWall(event.start_time, event.time_kind, tzid);
  const end = event.wall_end
    ? parseStoredWallDateTime(event.wall_end)
    : unixToFallbackWall(event.end_time, event.time_kind, tzid);
  return { start, end };
}

function unixToFallbackWall(unix: number, kind: DbCalendarEvent["time_kind"], tzid: string): WallDateTime {
  if (kind === "floating") {
    const date = new Date(unix * 1000);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  }
  return instantSecondsToWallDateTime(unix, tzid);
}

export function snapDeltaMinutes(minutes: number): number {
  return snapMinutes(minutes, SNAP_MINUTES);
}

export function applyTimedDraft(event: DbCalendarEvent, draft: TimedDraft): TimedDraftApplyResult {
  if (event.is_all_day === 1 || event.time_kind === "all-day") {
    return { ok: false, reason: "all-day" };
  }

  const deltaStart = snapDeltaMinutes(draft.deltaStartMinutes);
  const deltaEnd = snapDeltaMinutes(draft.deltaEndMinutes);
  const { start, end } = eventWallRange(event);
  const nextStart = addWallSeconds(start, deltaStart * 60);
  const nextEnd = addWallSeconds(end, deltaEnd * 60);
  const durationSeconds = wallSpanSeconds(nextStart, nextEnd);
  if (durationSeconds < MIN_DURATION_MINUTES * 60) {
    return { ok: false, reason: "invalid-duration" };
  }

  const time = buildEventTime(event, nextStart, nextEnd);
  const unchanged = deltaStart === 0 && deltaEnd === 0;
  return {
    ok: true,
    unchanged,
    time,
    input: updateInputFromTime(time),
  };
}

export function moveDraft(deltaMinutes: number): TimedDraft {
  const delta = snapDeltaMinutes(deltaMinutes);
  return { mode: "move", deltaStartMinutes: delta, deltaEndMinutes: delta };
}

export function resizeDraft(mode: "resize-start" | "resize-end", deltaMinutes: number): TimedDraft {
  const delta = snapDeltaMinutes(deltaMinutes);
  if (mode === "resize-start") return { mode, deltaStartMinutes: delta, deltaEndMinutes: 0 };
  return { mode, deltaStartMinutes: 0, deltaEndMinutes: delta };
}

/** Keep a draft inside the 15-minute minimum. Move never changes duration. */
export function clampTimedDraft(event: DbCalendarEvent, draft: TimedDraft): TimedDraft {
  const snapped: TimedDraft = {
    ...draft,
    deltaStartMinutes: snapDeltaMinutes(draft.deltaStartMinutes),
    deltaEndMinutes: snapDeltaMinutes(draft.deltaEndMinutes),
  };
  const applied = applyTimedDraft(event, snapped);
  if (applied.ok || applied.reason !== "invalid-duration") return snapped;

  const { start, end } = eventWallRange(event);
  const origMinutes = wallSpanSeconds(start, end) / 60;
  const maxShrink = origMinutes - MIN_DURATION_MINUTES;
  if (snapped.mode === "resize-end") {
    return resizeDraft("resize-end", Math.max(snapped.deltaEndMinutes, -maxShrink));
  }
  if (snapped.mode === "resize-start") {
    return resizeDraft("resize-start", Math.min(snapped.deltaStartMinutes, maxShrink));
  }
  return snapped;
}

export function previewLabel(time: CalendarEventTime): string {
  const start = time.kind === "timed-zoned" ? time.start.wall : time.kind === "floating" ? time.start : null;
  const end = time.kind === "timed-zoned" ? time.end.wall : time.kind === "floating" ? time.end : null;
  if (!start || !end) return "";
  return `${pad(start.hour)}:${pad(start.minute)}–${pad(end.hour)}:${pad(end.minute)}`;
}

function buildEventTime(event: DbCalendarEvent, start: WallDateTime, end: WallDateTime): CalendarEventTime {
  if (event.time_kind === "floating") {
    return { kind: "floating", start, end };
  }
  const tzid = event.tzid && event.tzid.length > 0 ? event.tzid : "UTC";
  return {
    kind: "timed-zoned",
    start: { wall: start, tzid, instant: zonedWallDateTimeToInstant(start, tzid) },
    end: { wall: end, tzid, instant: zonedWallDateTimeToInstant(end, tzid) },
  };
}

export function updateInputFromTime(time: CalendarEventTime): UpdateEventInput {
  if (time.kind === "floating") {
    return {
      isAllDay: false,
      time,
      startTime: formatWallDateTime(time.start),
      endTime: formatWallDateTime(time.end),
    };
  }
  if (time.kind === "timed-zoned") {
    return {
      isAllDay: false,
      time,
      startTime: new Date(time.start.instant * 1000).toISOString(),
      endTime: new Date(time.end.instant * 1000).toISOString(),
    };
  }
  return { isAllDay: true, time };
}

function wallSpanSeconds(start: WallDateTime, end: WallDateTime): number {
  const startMs = Date.UTC(start.year, start.month - 1, start.day, start.hour, start.minute, start.second);
  const endMs = Date.UTC(end.year, end.month - 1, end.day, end.hour, end.minute, end.second);
  return (endMs - startMs) / 1000;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
