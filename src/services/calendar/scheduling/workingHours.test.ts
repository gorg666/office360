import { describe, expect, it } from "vitest";
import { instantSecondsToWallDateTime, participantIdentityKey } from "../domain";
import { findCandidateSlots } from "./slots";
import { HOUR, availability, participantsOf, ref } from "./testFixtures";
import type { CandidateSearchInput } from "./slots";
import type { WorkingHours } from "./types";
import { assertSupportedWorkingHours, fitsWithinWorkingIntervals, workingIntervalsFor } from "./workingHours";

const DAY = Date.UTC(2026, 2, 16) / 1000;
const RANGE = { start: DAY + 8 * HOUR, end: DAY + 20 * HOUR };
const ivan = ref("ivan");
const anna = ref("anna");

const moscowNineToSix: WorkingHours = {
  timeZone: "Europe/Moscow",
  workingDays: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 18 * 60,
};

const bangkokNineToSix: WorkingHours = {
  timeZone: "Asia/Bangkok",
  workingDays: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 18 * 60,
};

function search(overrides: Partial<CandidateSearchInput> = {}): CandidateSearchInput {
  const participants = overrides.participants ?? participantsOf([ivan]);
  return {
    participants,
    availability: overrides.availability
      ?? participants.map((entry) => availability(entry.participant, "known", [], RANGE)),
    range: RANGE,
    durationSeconds: HOUR,
    granularitySeconds: HOUR,
    timeZone: "UTC",
    ...overrides,
  };
}

describe("working-hours constraint", () => {
  it("rejects overnight windows instead of inventing a wrap", () => {
    expect(() => assertSupportedWorkingHours({
      timeZone: "UTC",
      workingDays: [1],
      startMinute: 22 * 60,
      endMinute: 6 * 60,
    })).toThrow(/Overnight/);
  });

  it("is disabled when no constraint is supplied", () => {
    const slots = findCandidateSlots(search());
    expect(slots.every((slot) => slot.outsideWorkingHoursParticipants.length === 0)).toBe(true);
    expect(slots.every((slot) => slot.classification === "confirmed")).toBe(true);
  });

  it("keeps inside-hours slots confirmed under the prefer policy", () => {
    // 10:00 UTC = 13:00 Moscow on a Monday.
    const slots = findCandidateSlots(search({
      workingHours: { policy: "prefer", default: moscowNineToSix },
    }));
    const inside = slots.find((slot) => slot.start === DAY + 10 * HOUR)!;
    expect(inside.classification).toBe("confirmed");
    expect(inside.outsideWorkingHoursParticipants).toEqual([]);
    expect(fitsWithinWorkingIntervals(
      { start: DAY + 10 * HOUR, end: DAY + 11 * HOUR },
      workingIntervalsFor(moscowNineToSix, RANGE),
    )).toBe(true);
  });

  it("penalises outside-hours slots without turning them into busy time", () => {
    const slots = findCandidateSlots(search({
      workingHours: { policy: "prefer", default: moscowNineToSix },
    }));
    // 16:00 UTC = 19:00 Moscow, after 18:00 exclusive.
    const outside = slots.find((slot) => slot.start === DAY + 16 * HOUR)!;
    const inside = slots.find((slot) => slot.start === DAY + 10 * HOUR)!;
    expect(outside.classification).toBe("confirmed");
    expect(outside.outsideWorkingHoursParticipants).toEqual([0]);
    expect(outside.requiredConflicts).toEqual([{ participantIndex: 0, reason: "outside-working-hours" }]);
    expect(outside.score.total).toBeLessThan(inside.score.total);
  });

  it("blocks outside-hours required participants only under the require policy", () => {
    const slots = findCandidateSlots(search({
      workingHours: { policy: "require", default: moscowNineToSix },
    }));
    const outside = slots.find((slot) => slot.start === DAY + 16 * HOUR)!;
    expect(outside.classification).toBe("blocked");
    expect(outside.outsideWorkingHoursParticipants).toEqual([0]);
  });

  it("resolves each participant against their own timezone, not the display zone", () => {
    const participants = participantsOf([ivan, anna]);
    const slots = findCandidateSlots(search({
      participants,
      timeZone: "UTC",
      workingHours: {
        policy: "prefer",
        byParticipant: {
          [participantIdentityKey(ivan)]: moscowNineToSix,
          [participantIdentityKey(anna)]: bangkokNineToSix,
        },
      },
    }));
    // 12:00 UTC = 15:00 Moscow (inside) and 19:00 Bangkok (outside 18:00).
    const mixed = slots.find((slot) => slot.start === DAY + 12 * HOUR)!;
    expect(mixed.classification).toBe("confirmed");
    expect(mixed.outsideWorkingHoursParticipants).toEqual([1]);
    expect(instantSecondsToWallDateTime(mixed.start, "Europe/Moscow")).toMatchObject({ hour: 15 });
    expect(instantSecondsToWallDateTime(mixed.start, "Asia/Bangkok")).toMatchObject({ hour: 19 });
  });
});
