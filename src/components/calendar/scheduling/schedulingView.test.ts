import { describe, expect, it } from "vitest";
import { participantRefFromEmail } from "@/services/calendar/domain";
import type { CandidateSlot } from "@/services/calendar/scheduling";
import {
  buildEditorSchedulingParticipants,
  calendarDayRange,
  formatDateTimeLocal,
  layoutInterval,
  mergeOutsideWorkingHoursBands,
  optionalBusyCaption,
  outsideHoursCaption,
  parseDateTimeLocal,
  publicBusyIntervals,
  reliabilityCaption,
  rowShowsUnknownFill,
  unixFromDateTimeLocal,
} from "./schedulingView";

const SCORE: CandidateSlot["score"] = {
  total: 80,
  components: {
    classification: 80,
    optionalFree: 0,
    optionalTentative: 0,
    optionalUnknown: 0,
    optionalBusy: 0,
    workingHours: 0,
    earliness: 0,
  },
};

function slot(overrides: Partial<CandidateSlot> & Pick<CandidateSlot, "start" | "end">): CandidateSlot {
  return {
    classification: "confirmed",
    requiredConflicts: [],
    optionalConflicts: [],
    unknownParticipants: [],
    tentativeParticipants: [],
    outsideWorkingHoursParticipants: [],
    score: SCORE,
    ...overrides,
  };
}

describe("schedulingView", () => {
  it("round-trips datetime-local in the given IANA zone", () => {
    const wall = parseDateTimeLocal("2026-03-16T10:30");
    expect(wall).toEqual({ year: 2026, month: 3, day: 16, hour: 10, minute: 30, second: 0 });
    expect(formatDateTimeLocal(wall!)).toBe("2026-03-16T10:30");
    const unix = unixFromDateTimeLocal("2026-03-16T00:00", "UTC");
    expect(unix).toBe(Date.UTC(2026, 2, 16) / 1000);
    const range = calendarDayRange(unix!, "UTC");
    expect(range.end - range.start).toBe(86400);
  });

  it("keeps calendar-day length honest around DST by using the resolver", () => {
    const start = unixFromDateTimeLocal("2026-03-08T12:00", "America/New_York");
    const range = calendarDayRange(start!, "America/New_York");
    expect(range.end).toBeGreaterThan(range.start);
    expect(range.end - range.start).toBeGreaterThan(20 * 3600);
    expect(range.end - range.start).toBeLessThan(28 * 3600);
  });

  it("strips foreign event titles from busy intervals", () => {
    const poisoned = publicBusyIntervals({
      participant: participantRefFromEmail("other@example.test"),
      reliability: "known",
      source: "local-cache",
      busy: [{
        start: 10,
        end: 20,
        busyType: "busy",
        title: "Secret board meeting",
      } as never],
      range: { start: 0, end: 100 },
      timeZone: "UTC",
      observedAt: 0,
      dataAsOf: 0,
      diagnostics: [],
    });
    expect(poisoned).toEqual([{ start: 10, end: 20, busyType: "busy" }]);
    expect(JSON.stringify(poisoned)).not.toContain("Secret board meeting");
  });

  it("treats unknown reliability as not-free fill", () => {
    expect(rowShowsUnknownFill("known")).toBe(false);
    expect(rowShowsUnknownFill("unsupported")).toBe(true);
    expect(rowShowsUnknownFill("permission-denied")).toBe(true);
    expect(reliabilityCaption("permission-denied")).toBe("Нет доступа к занятости");
    expect(reliabilityCaption("unsupported")).toBe("Занятость недоступна через подключённый календарь");
  });

  it("builds editor participants without duplicating self", () => {
    const rows = buildEditorSchedulingParticipants({
      selfEmail: "Self@example.test",
      selfDisplayName: "Вы",
      attendeeEmails: ["self@example.test", "ivan@example.test"],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.isSelf).toBe(true);
    expect(rows[1]?.participant.normalizedEmail).toBe("ivan@example.test");
  });

  it("skips non-participant attendees and preserves optional", () => {
    const rows = buildEditorSchedulingParticipants({
      attendees: [
        { participant: participantRefFromEmail("anna@example.test"), role: "optional" },
        { participant: participantRefFromEmail("room@example.test"), role: "non-participant" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe("optional");
  });

  it("merges outside-hours candidate bands and captions them separately from busy", () => {
    const bands = mergeOutsideWorkingHoursBands([
      slot({ start: 10, end: 20, outsideWorkingHoursParticipants: [0] }),
      slot({ start: 20, end: 30, outsideWorkingHoursParticipants: [0] }),
      slot({ start: 50, end: 60 }),
    ]);
    expect(bands).toEqual([{ start: 10, end: 30 }]);
    expect(outsideHoursCaption(slot({ start: 10, end: 20, outsideWorkingHoursParticipants: [0] }))).toBe("вне рабочего времени");
    expect(optionalBusyCaption(slot({
      start: 10,
      end: 20,
      optionalConflicts: [{ participantIndex: 1, reason: "busy" }],
    }))).toBe("1 необязательный участник занят");
  });

  it("layouts intervals as percentages of the visible range", () => {
    const laid = layoutInterval({ start: 10, end: 20 }, { start: 0, end: 100 });
    expect(laid).toEqual({ start: 10, end: 20, leftPct: 10, widthPct: 10 });
  });
});
