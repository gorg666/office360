import { describe, expect, it } from "vitest";
import { instantSecondsToWallDateTime } from "@/services/calendar/domain";
import {
  allDayClickDraft,
  eventTimeFromFormFields,
  timedClickDraft,
  timedDragDraft,
  toEventCreateInput,
} from "./draft";

describe("createSelection draft", () => {
  it("clicks 10:30 to a 60-minute timed draft", () => {
    expect(timedClickDraft("2026-08-27", 10 * 60 + 30)).toEqual({
      kind: "timed",
      date: "2026-08-27",
      startMinutes: 630,
      endMinutes: 690,
    });
  });

  it("snaps a click to the nearest 15-minute boundary", () => {
    expect(timedClickDraft("2026-08-27", 10 * 60 + 37).startMinutes).toBe(10 * 60 + 30);
  });

  it("keeps a 10:00–11:30 drag and reverses 11:30 → 10:00", () => {
    expect(timedDragDraft("2026-08-27", 10 * 60, 11 * 60 + 30)).toEqual({
      kind: "timed",
      date: "2026-08-27",
      startMinutes: 600,
      endMinutes: 690,
    });
    expect(timedDragDraft("2026-08-27", 11 * 60 + 30, 10 * 60)).toEqual({
      kind: "timed",
      date: "2026-08-27",
      startMinutes: 600,
      endMinutes: 690,
    });
  });

  it("clamps a short drag to the 15-minute minimum instead of a zero-length event", () => {
    expect(timedDragDraft("2026-08-27", 10 * 60, 10 * 60 + 5)).toEqual({
      kind: "timed",
      date: "2026-08-27",
      startMinutes: 600,
      endMinutes: 615,
    });
  });

  it("does not invent a host date for week-column drafts", () => {
    const tuesday = timedClickDraft("2026-08-25", 14 * 60);
    expect(tuesday.kind).toBe("timed");
    if (tuesday.kind !== "timed") return;
    expect(tuesday.date).toBe("2026-08-25");
    expect(tuesday.startMinutes).toBe(14 * 60);
    expect(tuesday.endMinutes).toBe(15 * 60);
  });

  it("builds exclusive all-day semantics from a single cell click", () => {
    expect(allDayClickDraft("2026-08-27")).toEqual({
      kind: "all-day",
      startDate: "2026-08-27",
      endDateExclusive: "2026-08-28",
    });
  });

  it("maps timed drafts through the display timezone, not host midnight math", () => {
    const input = toEventCreateInput(timedClickDraft("2026-08-27", 10 * 60 + 30), "Europe/Moscow");
    expect(input.allDay).toBe(false);
    expect(input.startTime).toBe("2026-08-27T10:30");
    expect(input.endTime).toBe("2026-08-27T11:30");
    expect(input.time.kind).toBe("timed-zoned");
    if (input.time.kind !== "timed-zoned") return;
    expect(input.time.start.tzid).toBe("Europe/Moscow");
    expect(instantSecondsToWallDateTime(input.time.start.instant, "Europe/Moscow")).toEqual(input.time.start.wall);
  });

  it("keeps spillover Month dates on the cell calendar date", () => {
    const input = toEventCreateInput(allDayClickDraft("2026-07-26"), "UTC");
    expect(input.allDay).toBe(true);
    expect(input.startTime).toBe("2026-07-26");
    expect(input.time).toEqual({
      kind: "all-day",
      startDate: "2026-07-26",
      endDateExclusive: "2026-07-27",
    });
  });

  it("rebuilds form fields with CAL-102 instants", () => {
    const time = eventTimeFromFormFields({
      allDay: false,
      startTime: "2026-08-27T14:00",
      endTime: "2026-08-27T15:00",
      timeZone: "UTC",
    });
    expect(time?.kind).toBe("timed-zoned");
    if (time?.kind !== "timed-zoned") return;
    expect(time.start.instant).toBe(Date.UTC(2026, 7, 27, 14, 0) / 1000);
    expect(time.end.instant).toBe(Date.UTC(2026, 7, 27, 15, 0) / 1000);
  });
});

describe("createSelection DST", () => {
  it("shifts a New York spring gap wall time forward instead of inventing 02:30", () => {
    const input = toEventCreateInput(timedClickDraft("2026-03-08", 2 * 60 + 30), "America/New_York");
    expect(input.startTime).not.toBe("2026-03-08T02:30");
    expect(input.time.kind).toBe("timed-zoned");
    if (input.time.kind !== "timed-zoned") return;
    expect(input.time.start.wall.hour).toBeGreaterThanOrEqual(3);
    expect(instantSecondsToWallDateTime(input.time.start.instant, "America/New_York")).toEqual(input.time.start.wall);
  });

  it("picks the earlier New York fall overlap instant for 01:30", () => {
    const input = toEventCreateInput(timedClickDraft("2026-11-01", 90), "America/New_York");
    expect(input.startTime).toBe("2026-11-01T01:30");
    if (input.time.kind !== "timed-zoned") return;
    const later = input.time.start.instant + 3600;
    expect(instantSecondsToWallDateTime(later, "America/New_York").hour).toBe(1);
  });

  it("keeps Lord Howe half-hour offset on a visible slot", () => {
    const input = toEventCreateInput(timedClickDraft("2026-08-27", 10 * 60 + 30), "Australia/Lord_Howe");
    expect(input.startTime).toBe("2026-08-27T10:30");
    if (input.time.kind !== "timed-zoned") return;
    expect(input.time.start.tzid).toBe("Australia/Lord_Howe");
    expect(instantSecondsToWallDateTime(input.time.start.instant, "Australia/Lord_Howe").minute).toBe(30);
  });

  it("keeps UTC walls identical to the selected grid minutes", () => {
    const input = toEventCreateInput(timedDragDraft("2026-08-27", 10 * 60, 11 * 60 + 30), "UTC");
    expect(input.startTime).toBe("2026-08-27T10:00");
    expect(input.endTime).toBe("2026-08-27T11:30");
  });
});
