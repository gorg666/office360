import { describe, expect, it } from "vitest";
import { instantSecondsToWallDateTime, zonedWallDateTimeToInstant } from "../domain";
import { findCandidateSlots, candidateStarts, suggestSlots } from "./slots";
import { HOUR, availability, busy, participantsOf, ref, tentative } from "./testFixtures";
import type { CandidateSearchInput } from "./slots";

const DAY = Date.UTC(2026, 2, 16) / 1000;
const RANGE = { start: DAY + 9 * HOUR, end: DAY + 12 * HOUR };

const ivan = ref("ivan");
const anna = ref("anna");
const petr = ref("petr");

function search(overrides: Partial<CandidateSearchInput> = {}): CandidateSearchInput {
  const participants = overrides.participants ?? participantsOf([ivan]);
  return {
    participants,
    availability: overrides.availability
      ?? participants.map((entry) => availability(entry.participant, "known", [], RANGE)),
    range: RANGE,
    durationSeconds: HOUR,
    granularitySeconds: 30 * 60,
    timeZone: "UTC",
    ...overrides,
  };
}

const at = (slots: { start: number }[]) => slots.map((slot) => slot.start);

describe("required participant semantics", () => {
  it("confirms a slot when every required participant is provably free", () => {
    const participants = participantsOf([ivan, anna]);
    const slots = findCandidateSlots(search({
      participants,
      availability: participants.map((entry) => availability(entry.participant, "known", [], RANGE)),
    }));
    expect(slots.every((slot) => slot.classification === "confirmed")).toBe(true);
    expect(slots[0]?.requiredConflicts).toEqual([]);
  });

  it("blocks a slot overlapping a required busy interval", () => {
    const participants = participantsOf([ivan, anna]);
    const slots = findCandidateSlots(search({
      participants,
      availability: [
        availability(ivan, "known", [], RANGE),
        availability(anna, "known", [busy(DAY + 10 * HOUR, DAY + 11 * HOUR)], RANGE),
      ],
    }));
    const blocked = slots.filter((slot) => slot.classification === "blocked");
    expect(at(blocked)).toEqual([DAY + 9.5 * HOUR, DAY + 10 * HOUR, DAY + 10.5 * HOUR]);
    expect(blocked[0]?.requiredConflicts).toEqual([{ participantIndex: 1, reason: "busy" }]);
  });

  it("marks a required tentative conflict as possible, not blocked", () => {
    const slots = findCandidateSlots(search({
      availability: [availability(ivan, "known", [tentative(DAY + 10 * HOUR, DAY + 11 * HOUR)], RANGE)],
    }));
    const overlapping = slots.find((slot) => slot.start === DAY + 10 * HOUR);
    expect(overlapping?.classification).toBe("possible");
    expect(overlapping?.tentativeParticipants).toEqual([0]);
  });

  it.each([
    ["unknown"], ["unsupported"], ["permission-denied"], ["error"], ["partial"],
  ] as const)("never confirms a slot when a required participant is %s", (reliability) => {
    const participants = participantsOf([ivan, petr]);
    const slots = findCandidateSlots(search({
      participants,
      availability: [
        availability(ivan, "known", [], RANGE),
        availability(petr, reliability, [], RANGE),
      ],
    }));
    expect(slots.every((slot) => slot.classification === "unknown")).toBe(true);
    expect(slots[0]?.unknownParticipants).toEqual([1]);
    expect(slots[0]?.requiredConflicts).toEqual([{ participantIndex: 1, reason: "unknown" }]);
  });
});

describe("optional participant semantics", () => {
  it("keeps a slot valid when only an optional participant is busy, but ranks it lower", () => {
    const participants = participantsOf([ivan], [anna]);
    const slots = findCandidateSlots(search({
      participants,
      availability: [
        availability(ivan, "known", [], RANGE),
        availability(anna, "known", [busy(DAY + 10 * HOUR, DAY + 11 * HOUR)], RANGE),
      ],
    }));
    const conflicted = slots.find((slot) => slot.start === DAY + 10 * HOUR)!;
    const clean = slots.find((slot) => slot.start === DAY + 11 * HOUR)!;

    expect(conflicted.classification).toBe("confirmed");
    expect(conflicted.requiredConflicts).toEqual([]);
    expect(conflicted.optionalConflicts).toEqual([{ participantIndex: 1, reason: "busy" }]);
    expect(conflicted.score.total).toBeLessThan(clean.score.total);
  });
});

describe("duration and granularity", () => {
  it.each([15, 30, 60])("snaps candidate starts onto a %s-minute wall-clock grid", (minutes) => {
    const starts = candidateStarts(RANGE, "UTC", minutes * 60, minutes * 60);
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.every((start) => (start - RANGE.start) % (minutes * 60) === 0)).toBe(true);
  });

  it.each([15, 30, 60, 90])("only returns slots where a %s-minute meeting fits entirely", (minutes) => {
    const slots = findCandidateSlots(search({
      durationSeconds: minutes * 60,
      granularitySeconds: 15 * 60,
    }));
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((slot) => slot.end - slot.start === minutes * 60)).toBe(true);
    expect(slots.every((slot) => slot.end <= RANGE.end)).toBe(true);
  });

  it("snaps candidate starts to the granularity grid rather than to the range start", () => {
    const offset = { start: RANGE.start + 7 * 60, end: RANGE.end };
    const starts = candidateStarts(offset, "UTC", 30 * 60, HOUR);
    // 09:07 is not a candidate; the next 30-minute boundary is.
    expect(starts[0]).toBe(DAY + 9.5 * HOUR);
    expect(starts.every((start) => start % (30 * 60) === 0)).toBe(true);
  });
});

describe("multi-day ranges", () => {
  it.each([1, 3, 7])("covers a %s-day range", (days) => {
    const range = { start: DAY, end: DAY + days * 86400 };
    const starts = candidateStarts(range, "UTC", 60 * 60, HOUR);
    expect(starts).toHaveLength(days * 24);
    expect(starts[0]).toBe(DAY);
    expect(starts[starts.length - 1]).toBe(DAY + days * 86400 - HOUR);
  });
});

describe("timezone and DST independence", () => {
  it("keeps a 30-minute grid on the local wall clock across a spring-forward transition", () => {
    // 2026-03-08 in America/New_York: 02:00 local does not exist; the civil day lasts 23 hours.
    const start = zonedWallDateTimeToInstant(
      { year: 2026, month: 3, day: 8, hour: 0, minute: 0, second: 0 },
      "America/New_York",
    );
    const end = zonedWallDateTimeToInstant(
      { year: 2026, month: 3, day: 9, hour: 0, minute: 0, second: 0 },
      "America/New_York",
    );
    expect(end - start).toBe(23 * HOUR);
    const starts = candidateStarts({ start, end }, "America/New_York", 30 * 60, HOUR);
    const walls = starts.map((instant) => instantSecondsToWallDateTime(instant, "America/New_York"));
    expect([...new Set(walls.map((wall) => wall.minute))].sort((a, b) => a - b)).toEqual([0, 30]);
    expect(walls.every((wall) => wall.hour !== 2)).toBe(true);
    expect(starts.every((instant) => instant >= start && instant + HOUR <= end)).toBe(true);
  });

  it("produces identical instants for the same request regardless of the requested zone label", () => {
    const range = { start: DAY, end: DAY + 4 * HOUR };
    expect(candidateStarts(range, "UTC", 60 * 60, HOUR))
      .toEqual(candidateStarts(range, "Europe/Moscow", 60 * 60, HOUR));
  });
});

describe("ranking and suggestions", () => {
  it("orders confirmed > possible > unknown and never suggests blocked slots", () => {
    const participants = participantsOf([ivan, anna], [petr]);
    const slots = findCandidateSlots(search({
      participants,
      durationSeconds: HOUR,
      granularitySeconds: HOUR,
      range: { start: DAY + 9 * HOUR, end: DAY + 14 * HOUR },
      availability: [
        availability(ivan, "known", [busy(DAY + 9 * HOUR, DAY + 10 * HOUR)], { start: DAY + 9 * HOUR, end: DAY + 14 * HOUR }),
        availability(anna, "known", [tentative(DAY + 10 * HOUR, DAY + 11 * HOUR)], { start: DAY + 9 * HOUR, end: DAY + 14 * HOUR }),
        availability(petr, "known", [busy(DAY + 12 * HOUR, DAY + 13 * HOUR)], { start: DAY + 9 * HOUR, end: DAY + 14 * HOUR }),
      ],
    }));
    const byStart = new Map(slots.map((slot) => [slot.start, slot] as const));
    const blocked = byStart.get(DAY + 9 * HOUR)!;
    const possible = byStart.get(DAY + 10 * HOUR)!;
    const confirmedOptionalBusy = byStart.get(DAY + 12 * HOUR)!;
    const confirmedAllFree = byStart.get(DAY + 11 * HOUR)!;

    expect(blocked.classification).toBe("blocked");
    expect(possible.classification).toBe("possible");
    expect(confirmedOptionalBusy.classification).toBe("confirmed");
    expect(confirmedAllFree.classification).toBe("confirmed");

    expect(confirmedAllFree.score.total).toBeGreaterThan(confirmedOptionalBusy.score.total);
    expect(confirmedOptionalBusy.score.total).toBeGreaterThan(possible.score.total);
    expect(possible.score.total).toBeGreaterThan(blocked.score.total);

    const suggestions = suggestSlots(slots, 3);
    expect(suggestions).toHaveLength(3);
    expect(suggestions.every((slot) => slot.classification !== "blocked")).toBe(true);
    expect(suggestions[0]?.start).toBe(DAY + 11 * HOUR);
  });

  it("prefers the earlier slot when everything else is equal", () => {
    const slots = findCandidateSlots(search({ granularitySeconds: HOUR }));
    const suggestions = suggestSlots(slots, 2);
    expect(suggestions[0]!.start).toBeLessThan(suggestions[1]!.start);
  });

  it("is deterministic for identical input", () => {
    const input = search({ granularitySeconds: HOUR });
    expect(suggestSlots(findCandidateSlots(input), 3))
      .toEqual(suggestSlots(findCandidateSlots(input), 3));
  });

  it("ranks unknown below possible and above blocked", () => {
    const hourSearch = { durationSeconds: HOUR, granularitySeconds: HOUR };
    const possible = findCandidateSlots(search({
      ...hourSearch,
      availability: [availability(ivan, "known", [tentative(DAY + 9 * HOUR, DAY + 10 * HOUR)], RANGE)],
    })).find((slot) => slot.start === DAY + 9 * HOUR)!;
    const unknown = findCandidateSlots(search({
      ...hourSearch,
      availability: [availability(ivan, "unsupported", [], RANGE)],
    })).find((slot) => slot.start === DAY + 9 * HOUR)!;
    const blocked = findCandidateSlots(search({
      ...hourSearch,
      availability: [availability(ivan, "known", [busy(DAY + 9 * HOUR, DAY + 10 * HOUR)], RANGE)],
    })).find((slot) => slot.start === DAY + 9 * HOUR)!;

    expect(possible.classification).toBe("possible");
    expect(unknown.classification).toBe("unknown");
    expect(blocked.classification).toBe("blocked");
    expect(possible.score.total).toBeGreaterThan(unknown.score.total);
    expect(unknown.score.total).toBeGreaterThan(blocked.score.total);
  });
});
