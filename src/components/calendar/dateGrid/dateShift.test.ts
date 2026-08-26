import { describe, expect, it } from "vitest";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import {
  calendarDateToUnixSeconds,
  parseWallDateTime,
  zonedWallDateTimeToInstant,
} from "@/services/calendar/domain";
import { applyDateGridDraft, occupiedSpanDays } from "./dateShift";

function event(overrides: Partial<DbCalendarEvent> = {}): DbCalendarEvent {
  return {
    id: "event-1", account_id: "account-1", google_event_id: "/cal/plain.ics",
    summary: "Standup", description: null, location: null,
    start_time: 1_800_000_000, end_time: 1_800_003_600, is_all_day: 0,
    status: "confirmed", organizer_email: null, attendees_json: null, html_link: null,
    updated_at: 1, calendar_id: "cal-1", remote_event_id: "/cal/plain.ics",
    etag: '"v1"', ical_data: null, uid: "plain-1", time_kind: "timed-zoned",
    tzid: "UTC", wall_start: "2027-01-15T14:30:00", wall_end: "2027-01-15T15:30:00",
    end_date_exclusive: null, series_uid: null, occurrence_key: null,
    is_recurrence_master: 0, transp: null, sequence: 0, origin: "remote",
    projection_key: null, projection_status: null, ...overrides,
  };
}

function allDay(startDate: string, endDateExclusive: string, overrides: Partial<DbCalendarEvent> = {}) {
  return event({
    is_all_day: 1,
    time_kind: "all-day",
    tzid: null,
    wall_start: null,
    wall_end: null,
    start_time: calendarDateToUnixSeconds(startDate as `${number}-${number}-${number}`),
    end_time: calendarDateToUnixSeconds(endDateExclusive as `${number}-${number}-${number}`),
    end_date_exclusive: endDateExclusive,
    ...overrides,
  });
}

function timedWall(applied: ReturnType<typeof applyDateGridDraft>) {
  if (!applied.ok) throw new Error(applied.reason);
  if (applied.time.kind === "all-day") throw new Error("expected timed");
  const start = applied.time.kind === "floating" ? applied.time.start : applied.time.start.wall;
  const end = applied.time.kind === "floating" ? applied.time.end : applied.time.end.wall;
  return { start, end, time: applied.time, input: applied.input, unchanged: applied.unchanged };
}

describe("dateGrid shift", () => {
  it("moves a timed event same-week and preserves wall time and duration", () => {
    const applied = applyDateGridDraft(event(), { type: "shift", deltaDays: 2 });
    const { start, end } = timedWall(applied);
    expect(start).toMatchObject({ year: 2027, month: 1, day: 17, hour: 14, minute: 30 });
    expect(end).toMatchObject({ year: 2027, month: 1, day: 17, hour: 15, minute: 30 });
    expect(applied.ok && applied.input.isAllDay).toBe(false);
  });

  it("moves a timed event across a week and month boundary", () => {
    const source = event({
      wall_start: "2027-01-30T14:30:00",
      wall_end: "2027-01-30T15:30:00",
    });
    const week = timedWall(applyDateGridDraft(source, { type: "shift", deltaDays: 8 }));
    expect(week.start).toMatchObject({ year: 2027, month: 2, day: 7, hour: 14, minute: 30 });
    const month = timedWall(applyDateGridDraft(source, { type: "shift", deltaDays: 3 }));
    expect(month.start).toMatchObject({ year: 2027, month: 2, day: 2, hour: 14, minute: 30 });
  });

  it("does not mutate when delta is zero", () => {
    const applied = applyDateGridDraft(event(), { type: "shift", deltaDays: 0 });
    expect(applied.ok && applied.unchanged).toBe(true);
  });

  it("moves a single-day all-day event without converting it to timed", () => {
    const applied = applyDateGridDraft(allDay("2027-01-15", "2027-01-16"), { type: "shift", deltaDays: 2 });
    expect(applied.ok).toBe(true);
    if (!applied.ok || applied.time.kind !== "all-day") throw new Error("expected all-day");
    expect(applied.time.startDate).toBe("2027-01-17");
    expect(applied.time.endDateExclusive).toBe("2027-01-18");
    expect(applied.input.isAllDay).toBe(true);
  });

  it("shifts a multi-day all-day span by the same number of calendar days", () => {
    const applied = applyDateGridDraft(allDay("2027-01-20", "2027-01-23"), { type: "shift", deltaDays: 5 });
    expect(applied.ok).toBe(true);
    if (!applied.ok || applied.time.kind !== "all-day") throw new Error("expected all-day");
    expect(applied.time.startDate).toBe("2027-01-25");
    expect(applied.time.endDateExclusive).toBe("2027-01-28");
    expect(occupiedSpanDays(applied.time.startDate, applied.time.endDateExclusive)).toBe(3);
  });
});

describe("timed ↔ all-day conversion", () => {
  it("converts timed to all-day with occupied calendar-date span", () => {
    const applied = applyDateGridDraft(event(), { type: "to-all-day", startDate: "2027-01-18" });
    expect(applied.ok).toBe(true);
    if (!applied.ok || applied.time.kind !== "all-day") throw new Error("expected all-day");
    expect(applied.time.startDate).toBe("2027-01-18");
    expect(applied.time.endDateExclusive).toBe("2027-01-19");
    expect(applied.input.isAllDay).toBe(true);
    expect(applied.input.time?.kind).toBe("all-day");
  });

  it("converts all-day to timed with default 60-minute duration and snap", () => {
    const applied = applyDateGridDraft(
      allDay("2027-01-15", "2027-01-16"),
      { type: "to-timed", startDate: "2027-01-15", startMinutesFromMidnight: 14 * 60 + 7 },
    );
    const { start, end, input } = timedWall(applied);
    expect(start).toMatchObject({ year: 2027, month: 1, day: 15, hour: 14, minute: 0 });
    expect(end).toMatchObject({ year: 2027, month: 1, day: 15, hour: 15, minute: 0 });
    expect(input.isAllDay).toBe(false);
  });

  it("keeps floating events floating on shift and conversion", () => {
    const floating = event({
      time_kind: "floating",
      tzid: null,
      start_time: Date.UTC(2027, 0, 15, 14, 30, 0) / 1000,
      end_time: Date.UTC(2027, 0, 15, 15, 30, 0) / 1000,
    });
    const shifted = applyDateGridDraft(floating, { type: "shift", deltaDays: 2 });
    expect(shifted.ok && shifted.time.kind).toBe("floating");
    const converted = applyDateGridDraft(floating, {
      type: "to-timed",
      startDate: "2027-01-20",
      startMinutesFromMidnight: 9 * 60,
    });
    expect(converted.ok && converted.time.kind).toBe("floating");
  });
});

describe("dateGrid DST / timezone matrix", () => {
  it("keeps America/New_York 09:00 wall-clock when moving across the spring-forward date", () => {
    const tzid = "America/New_York";
    const startWall = parseWallDateTime("20260307T090000");
    const endWall = parseWallDateTime("20260307T100000");
    const source = event({
      tzid,
      wall_start: "2026-03-07T09:00:00",
      wall_end: "2026-03-07T10:00:00",
      start_time: zonedWallDateTimeToInstant(startWall, tzid),
      end_time: zonedWallDateTimeToInstant(endWall, tzid),
    });
    const applied = applyDateGridDraft(source, { type: "shift", deltaDays: 1 });
    const { start, end, time } = timedWall(applied);
    expect(start).toMatchObject({ year: 2026, month: 3, day: 8, hour: 9, minute: 0 });
    expect(end).toMatchObject({ year: 2026, month: 3, day: 8, hour: 10, minute: 0 });
    if (time.kind !== "timed-zoned") throw new Error("expected zoned");
    expect(time.start.instant).toBe(zonedWallDateTimeToInstant(parseWallDateTime("20260308T090000"), tzid));
    expect(time.start.instant - source.start_time).not.toBe(86400);
  });

  it("keeps Australia/Lord_Howe 09:00 wall-clock across the 30-minute spring-forward date", () => {
    const tzid = "Australia/Lord_Howe";
    const startWall = parseWallDateTime("20261003T090000");
    const endWall = parseWallDateTime("20261003T100000");
    const source = event({
      tzid,
      wall_start: "2026-10-03T09:00:00",
      wall_end: "2026-10-03T10:00:00",
      start_time: zonedWallDateTimeToInstant(startWall, tzid),
      end_time: zonedWallDateTimeToInstant(endWall, tzid),
    });
    const applied = applyDateGridDraft(source, { type: "shift", deltaDays: 1 });
    const { start, time } = timedWall(applied);
    expect(start).toMatchObject({ year: 2026, month: 10, day: 4, hour: 9, minute: 0 });
    if (time.kind !== "timed-zoned") throw new Error("expected zoned");
    expect(time.start.instant).toBe(zonedWallDateTimeToInstant(parseWallDateTime("20261004T090000"), tzid));
  });

  it("does not shift an all-day date because of the host timezone", () => {
    const applied = applyDateGridDraft(allDay("2026-03-08", "2026-03-09"), { type: "shift", deltaDays: 1 });
    expect(applied.ok).toBe(true);
    if (!applied.ok || applied.time.kind !== "all-day") throw new Error("expected all-day");
    expect(applied.time.startDate).toBe("2026-03-09");
    expect(applied.time.endDateExclusive).toBe("2026-03-10");
  });

  it("keeps UTC 09:00 wall-clock on a calendar-date move", () => {
    const tzid = "UTC";
    const source = event({
      tzid,
      wall_start: "2026-03-08T09:00:00",
      wall_end: "2026-03-08T10:00:00",
      start_time: zonedWallDateTimeToInstant(parseWallDateTime("20260308T090000"), tzid),
      end_time: zonedWallDateTimeToInstant(parseWallDateTime("20260308T100000"), tzid),
    });
    const { start } = timedWall(applyDateGridDraft(source, { type: "shift", deltaDays: 1 }));
    expect(start).toMatchObject({ year: 2026, month: 3, day: 9, hour: 9, minute: 0 });
  });

  it("keeps Europe/Moscow 09:00 wall-clock on a calendar-date move", () => {
    const tzid = "Europe/Moscow";
    const source = event({
      tzid,
      wall_start: "2026-03-08T09:00:00",
      wall_end: "2026-03-08T10:00:00",
      start_time: zonedWallDateTimeToInstant(parseWallDateTime("20260308T090000"), tzid),
      end_time: zonedWallDateTimeToInstant(parseWallDateTime("20260308T100000"), tzid),
    });
    const { start } = timedWall(applyDateGridDraft(source, { type: "shift", deltaDays: 1 }));
    expect(start).toMatchObject({ year: 2026, month: 3, day: 9, hour: 9, minute: 0 });
  });
});
