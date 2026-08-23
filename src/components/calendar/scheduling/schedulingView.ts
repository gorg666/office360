import {
  participantIdentityKey,
  participantRefFromEmail,
  instantSecondsToWallDateTime,
  zonedWallDateTimeToInstant,
  type AttendanceRole,
  type ParticipantRef,
  type WallDateTime,
} from "@/services/calendar/domain";
import type { AvailabilityReliability, BusyInterval, ParticipantAvailability } from "@/services/calendar/freeBusy";
import type {
  CandidateSlot,
  GroupAvailabilitySegment,
  ParticipantRole,
  SlotClassification,
} from "@/services/calendar/scheduling";

export const DEFAULT_GRANULARITY_SECONDS = 30 * 60;
export const GRANULARITY_OPTIONS = [15 * 60, 30 * 60, 60 * 60] as const;
export const HOUR_COLUMN_PX = 52;

export interface TimelineTick {
  unix: number;
  label: string;
}

export interface LaidOutInterval {
  start: number;
  end: number;
  leftPct: number;
  widthPct: number;
}

const DATE_TIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

export function parseDateTimeLocal(value: string): WallDateTime | null {
  const match = DATE_TIME_LOCAL.exec(value);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
}

export function formatDateTimeLocal(wall: WallDateTime): string {
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

export function unixFromDateTimeLocal(value: string, timeZone: string): number | null {
  const wall = parseDateTimeLocal(value);
  if (!wall) return null;
  return zonedWallDateTimeToInstant(wall, timeZone);
}

export function dateTimeLocalFromUnix(unix: number, timeZone: string): string {
  return formatDateTimeLocal(instantSecondsToWallDateTime(unix, timeZone));
}

function fromUtcParts(utcMs: number): WallDateTime {
  const date = new Date(utcMs);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

export function addCalendarDays(wall: WallDateTime, days: number): WallDateTime {
  return fromUtcParts(Date.UTC(wall.year, wall.month - 1, wall.day + days, wall.hour, wall.minute, wall.second));
}

export function addWallHours(wall: WallDateTime, hours: number): WallDateTime {
  return fromUtcParts(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour + hours, wall.minute, wall.second));
}

export function calendarDayRange(anchorUnix: number, timeZone: string): { start: number; end: number } {
  const wall = instantSecondsToWallDateTime(anchorUnix, timeZone);
  const startWall = { ...wall, hour: 0, minute: 0, second: 0 };
  const start = zonedWallDateTimeToInstant(startWall, timeZone);
  const end = zonedWallDateTimeToInstant(addCalendarDays(startWall, 1), timeZone);
  return { start, end };
}

export function hourTicks(range: { start: number; end: number }, timeZone: string): TimelineTick[] {
  const ticks: TimelineTick[] = [];
  const startWall = instantSecondsToWallDateTime(range.start, timeZone);
  let wall = { ...startWall, minute: 0, second: 0 };
  let cursor = zonedWallDateTimeToInstant(wall, timeZone);
  if (cursor < range.start) {
    wall = addWallHours(wall, 1);
    cursor = zonedWallDateTimeToInstant(wall, timeZone);
  }
  let guard = 0;
  while (cursor < range.end && guard < 48) {
    const tickWall = instantSecondsToWallDateTime(cursor, timeZone);
    ticks.push({ unix: cursor, label: `${pad(tickWall.hour)}:00` });
    const nextWall = addWallHours({ ...tickWall, minute: 0, second: 0 }, 1);
    let next = zonedWallDateTimeToInstant(nextWall, timeZone);
    if (next <= cursor) next = cursor + 3600;
    cursor = next;
    guard += 1;
  }
  return ticks;
}

export function layoutInterval(
  interval: { start: number; end: number },
  range: { start: number; end: number },
): LaidOutInterval | null {
  const span = range.end - range.start;
  if (span <= 0) return null;
  const start = Math.max(interval.start, range.start);
  const end = Math.min(interval.end, range.end);
  if (end <= start) return null;
  return {
    start,
    end,
    leftPct: ((start - range.start) / span) * 100,
    widthPct: ((end - start) / span) * 100,
  };
}

export function unixAtOffset(offsetPx: number, totalWidth: number, range: { start: number; end: number }): number {
  if (totalWidth <= 0) return range.start;
  const ratio = Math.min(1, Math.max(0, offsetPx / totalWidth));
  return Math.floor(range.start + ratio * (range.end - range.start));
}

export function candidateAtInstant(candidates: readonly CandidateSlot[], instant: number): CandidateSlot | undefined {
  return candidates.find((slot) => instant >= slot.start && instant < slot.end);
}

/** Strip anything except geometry + busyType so a poisoned title never reaches the UI. */
export function publicBusyIntervals(availability: ParticipantAvailability | undefined): BusyInterval[] {
  return (availability?.busy ?? []).map((interval) => ({
    start: interval.start,
    end: interval.end,
    busyType: interval.busyType,
  }));
}

export function rowShowsUnknownFill(reliability: AvailabilityReliability): boolean {
  return reliability !== "known";
}

export function reliabilityCaption(reliability: AvailabilityReliability): string | null {
  switch (reliability) {
    case "permission-denied":
      return "Нет доступа к занятости";
    case "unsupported":
      return "Занятость недоступна через подключённый календарь";
    case "unknown":
    case "error":
      return "Нет данных о занятости";
    case "partial":
      return "Неполные данные о занятости";
    default:
      return null;
  }
}

export function roleLabel(role: ParticipantRole): string {
  return role === "optional" ? "Необязательный" : "Обязательный";
}

export function classificationLabel(classification: SlotClassification): string {
  switch (classification) {
    case "confirmed":
      return "Все обязательные свободны";
    case "possible":
      return "Возможно подходит";
    case "unknown":
      return "Не удалось подтвердить занятость всех участников";
    case "blocked":
      return "Обязательный участник занят";
  }
}

export function optionalBusyCaption(slot: CandidateSlot): string | null {
  const count = slot.optionalConflicts.filter((conflict) => conflict.reason === "busy").length;
  if (count <= 0) return null;
  if (count === 1) return "1 необязательный участник занят";
  return `${count} необязательных участников заняты`;
}

export function outsideHoursCaption(slot: CandidateSlot): string | null {
  return slot.outsideWorkingHoursParticipants.length > 0 ? "вне рабочего времени" : null;
}

export function mergeOutsideWorkingHoursBands(
  candidates: readonly CandidateSlot[],
): Array<{ start: number; end: number }> {
  const raw = candidates
    .filter((slot) => slot.outsideWorkingHoursParticipants.length > 0)
    .map((slot) => ({ start: slot.start, end: slot.end }))
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of raw) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

export function schedulingRoleFromAttendance(role: AttendanceRole): ParticipantRole {
  return role === "optional" ? "optional" : "required";
}

export interface EditorSchedulingParticipant {
  participant: ParticipantRef;
  role: ParticipantRole;
  isSelf: boolean;
}

export function buildEditorSchedulingParticipants(input: {
  selfEmail?: string | null;
  selfDisplayName?: string | null;
  attendees?: ReadonlyArray<{ participant: ParticipantRef; role: AttendanceRole }>;
  attendeeEmails?: readonly string[];
}): EditorSchedulingParticipant[] {
  const rows: EditorSchedulingParticipant[] = [];
  const seen = new Set<string>();
  const push = (participant: ParticipantRef, role: ParticipantRole, isSelf: boolean) => {
    const key = participantIdentityKey(participant);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ participant, role, isSelf });
  };

  if (input.selfEmail?.trim()) {
    push(
      participantRefFromEmail(input.selfEmail, input.selfDisplayName ?? undefined),
      "required",
      true,
    );
  }

  for (const attendee of input.attendees ?? []) {
    if (attendee.role === "non-participant") continue;
    const self = input.selfEmail
      ? participantIdentityKey(participantRefFromEmail(input.selfEmail)) === participantIdentityKey(attendee.participant)
      : false;
    push(attendee.participant, schedulingRoleFromAttendance(attendee.role), self);
  }

  for (const email of input.attendeeEmails ?? []) {
    push(participantRefFromEmail(email), "required", false);
  }

  return rows;
}

export function busyTypeLabel(busyType: BusyInterval["busyType"]): string {
  return busyType === "tentative" ? "Под вопросом" : "Занят";
}

export function formatSuggestionWhen(
  slot: { start: number; end: number },
  timeZone: string,
  nowUnix: number,
): string {
  const start = instantSecondsToWallDateTime(slot.start, timeZone);
  const end = instantSecondsToWallDateTime(slot.end, timeZone);
  const today = instantSecondsToWallDateTime(nowUnix, timeZone);
  const datePart = sameCalendarDay(start, today)
    ? "Сегодня"
    : `${pad(start.day)}.${pad(start.month)}`;
  return `${datePart} ${pad(start.hour)}:${pad(start.minute)}–${pad(end.hour)}:${pad(end.minute)}`;
}

export function participantInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  return displayName.trim().slice(0, 2).toUpperCase() || "?";
}

export function sameCalendarDay(a: WallDateTime, b: WallDateTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function segmentAriaLabel(segment: GroupAvailabilitySegment): string {
  return classificationLabel(segment.classification);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}
