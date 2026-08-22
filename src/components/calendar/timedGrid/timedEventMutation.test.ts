import { describe, expect, it } from "vitest";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { parseWallDateTime, zonedWallDateTimeToInstant } from "@/services/calendar/domain";
import { MIN_DURATION_MINUTES } from "./constants";
import {
  applyTimedDraft,
  clampTimedDraft,
  moveDraft,
  resizeDraft,
} from "./timedEventMutation";

function event(overrides: Partial<DbCalendarEvent> = {}): DbCalendarEvent {
  return {
    id: "event-1", account_id: "account-1", google_event_id: "/cal/plain.ics",
    summary: "Standup", description: null, location: null,
    start_time: 1_800_000_000, end_time: 1_800_003_600, is_all_day: 0,
    status: "confirmed", organizer_email: null, attendees_json: null, html_link: null,
    updated_at: 1, calendar_id: "cal-1", remote_event_id: "/cal/plain.ics",
    etag: '"v1"', ical_data: null, uid: "plain-1", time_kind: "timed-zoned",
    tzid: "UTC", wall_start: "2027-01-15T10:00:00", wall_end: "2027-01-15T11:00:00",
    end_date_exclusive: null, series_uid: null, occurrence_key: null,
    is_recurrence_master: 0, transp: null, sequence: 0, origin: "remote",
    projection_key: null, projection_status: null, ...overrides,
  };
}

function wallOf(result: ReturnType<typeof applyTimedDraft>) {
  if (!result.ok || result.time.kind === "all-day") throw new Error("expected timed result");
  const start = result.time.kind === "floating" ? result.time.start : result.time.start.wall;
  const end = result.time.kind === "floating" ? result.time.end : result.time.end.wall;
  return { start, end, time: result.time };
}

describe("timed event mutation drafts", () => {
  it("moves a timed event by +90 minutes and preserves duration", () => {
    const applied = applyTimedDraft(event(), moveDraft(90));
    const { start, end } = wallOf(applied);
    expect(start).toMatchObject({ year: 2027, month: 1, day: 15, hour: 11, minute: 30 });
    expect(end).toMatchObject({ year: 2027, month: 1, day: 15, hour: 12, minute: 30 });
  });

  it("moves across a calendar day while preserving the wall duration", () => {
    const applied = applyTimedDraft(event(), moveDraft(24 * 60));
    const { start, end } = wallOf(applied);
    expect(start).toMatchObject({ year: 2027, month: 1, day: 16, hour: 10, minute: 0 });
    expect(end).toMatchObject({ year: 2027, month: 1, day: 16, hour: 11, minute: 0 });
  });

  it("snaps a 7-minute pointer delta to no change and 8 minutes to +15", () => {
    expect(applyTimedDraft(event(), moveDraft(7)).unchanged).toBe(true);
    const snapped = wallOf(applyTimedDraft(event(), moveDraft(8)));
    expect(snapped.start.minute).toBe(15);
    expect(snapped.end.minute).toBe(15);
  });

  it("resizes the end without moving the start", () => {
    const { start, end } = wallOf(applyTimedDraft(event(), resizeDraft("resize-end", 30)));
    expect(start).toMatchObject({ hour: 10, minute: 0 });
    expect(end).toMatchObject({ hour: 11, minute: 30 });
  });

  it("resizes the start without moving the end", () => {
    const { start, end } = wallOf(applyTimedDraft(event(), resizeDraft("resize-start", 30)));
    expect(start).toMatchObject({ hour: 10, minute: 30 });
    expect(end).toMatchObject({ hour: 11, minute: 0 });
  });

  it("rejects an inverted duration before clamp", () => {
    expect(applyTimedDraft(event(), resizeDraft("resize-end", -60)).ok).toBe(false);
  });

  it("clamps resize so duration cannot fall below 15 minutes", () => {
    expect(MIN_DURATION_MINUTES).toBe(15);
    const clamped = clampTimedDraft(event(), resizeDraft("resize-end", -120));
    const { start, end } = wallOf(applyTimedDraft(event(), clamped));
    expect(start).toMatchObject({ hour: 10, minute: 0 });
    expect(end).toMatchObject({ hour: 10, minute: 15 });
  });

  it("keeps floating events floating", () => {
    const floating = event({
      time_kind: "floating",
      tzid: null,
      start_time: Date.UTC(2027, 0, 15, 10, 0, 0) / 1000,
      end_time: Date.UTC(2027, 0, 15, 11, 0, 0) / 1000,
    });
    const applied = applyTimedDraft(floating, moveDraft(90));
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.time.kind).toBe("floating");
    expect(applied.input.time?.kind).toBe("floating");
    const { start, end } = wallOf(applied);
    expect(start).toMatchObject({ hour: 11, minute: 30 });
    expect(end).toMatchObject({ hour: 12, minute: 30 });
  });
});

describe("timed drag DST wall-clock semantics", () => {
  it("moves +60 wall minutes in America/New_York without unix +3600 on the gap edge", () => {
    const tzid = "America/New_York";
    const startWall = parseWallDateTime("20260308T003000");
    const endWall = parseWallDateTime("20260308T013000");
    const source = event({
      tzid,
      wall_start: "2026-03-08T00:30:00",
      wall_end: "2026-03-08T01:30:00",
      start_time: zonedWallDateTimeToInstant(startWall, tzid),
      end_time: zonedWallDateTimeToInstant(endWall, tzid),
    });
    const applied = applyTimedDraft(source, moveDraft(60));
    const { start, end, time } = wallOf(applied);
    expect(start).toMatchObject({ year: 2026, month: 3, day: 8, hour: 1, minute: 30 });
    expect(end).toMatchObject({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 });
    if (time.kind !== "timed-zoned") throw new Error("expected zoned");
    expect(time.start.instant).toBe(zonedWallDateTimeToInstant(parseWallDateTime("20260308T013000"), tzid));
    expect(time.end.instant).toBe(zonedWallDateTimeToInstant(parseWallDateTime("20260308T023000"), tzid));
    expect(time.end.instant - source.end_time).not.toBe(3600);
  });

  it("moves +60 wall minutes across the Lord Howe 30-minute spring-forward", () => {
    const tzid = "Australia/Lord_Howe";
    const startWall = parseWallDateTime("20261004T013000");
    const endWall = parseWallDateTime("20261004T023000");
    const source = event({
      tzid,
      wall_start: "2026-10-04T01:30:00",
      wall_end: "2026-10-04T02:30:00",
      start_time: zonedWallDateTimeToInstant(startWall, tzid),
      end_time: zonedWallDateTimeToInstant(endWall, tzid),
    });
    const applied = applyTimedDraft(source, moveDraft(60));
    const { start, end, time } = wallOf(applied);
    expect(start).toMatchObject({ year: 2026, month: 10, day: 4, hour: 2, minute: 30 });
    expect(end).toMatchObject({ year: 2026, month: 10, day: 4, hour: 3, minute: 30 });
    if (time.kind !== "timed-zoned") throw new Error("expected zoned");
    expect(time.start.instant).toBe(zonedWallDateTimeToInstant(parseWallDateTime("20261004T023000"), tzid));
    expect(time.start.instant - source.start_time).not.toBe(3600);
  });
});
