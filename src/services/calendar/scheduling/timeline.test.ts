import { describe, expect, it } from "vitest";
import { buildGroupTimeline, classifyRequiredStates } from "./timeline";
import { HOUR, availability, busy, participantsOf, ref, tentative } from "./testFixtures";

const DAY = Date.UTC(2026, 2, 16) / 1000;
const RANGE = { start: DAY + 9 * HOUR, end: DAY + 13 * HOUR };

const ivan = ref("ivan");
const anna = ref("anna");
const petr = ref("petr");

describe("required-state classification", () => {
  it("orders severity as blocked > unknown > possible > confirmed", () => {
    expect(classifyRequiredStates(["free", "free"])).toBe("confirmed");
    expect(classifyRequiredStates(["free", "tentative"])).toBe("possible");
    expect(classifyRequiredStates(["free", "unknown"])).toBe("unknown");
    expect(classifyRequiredStates(["free", "busy"])).toBe("blocked");
    // A definite conflict outranks missing data; missing data outranks a soft conflict.
    expect(classifyRequiredStates(["unknown", "busy"])).toBe("blocked");
    expect(classifyRequiredStates(["tentative", "unknown"])).toBe("unknown");
    expect(classifyRequiredStates([])).toBe("confirmed");
  });
});

describe("group timeline segmentation", () => {
  it("splits the range at every participant boundary", () => {
    const participants = participantsOf([ivan, anna]);
    const segments = buildGroupTimeline(participants, [
      availability(ivan, "known", [busy(DAY + 10 * HOUR, DAY + 11 * HOUR)], RANGE),
      availability(anna, "known", [busy(DAY + 10.5 * HOUR, DAY + 12 * HOUR)], RANGE),
    ], RANGE);

    expect(segments.map((segment) => [segment.start, segment.end])).toEqual([
      [DAY + 9 * HOUR, DAY + 10 * HOUR],
      [DAY + 10 * HOUR, DAY + 10.5 * HOUR],
      [DAY + 10.5 * HOUR, DAY + 11 * HOUR],
      [DAY + 11 * HOUR, DAY + 12 * HOUR],
      [DAY + 12 * HOUR, DAY + 13 * HOUR],
    ]);
    expect(segments.map((segment) => segment.classification))
      .toEqual(["confirmed", "blocked", "blocked", "blocked", "confirmed"]);
    expect(segments[1]?.requiredBusy).toEqual([0]);
    expect(segments[2]?.requiredBusy).toEqual([0, 1]);
    expect(segments[3]?.requiredBusy).toEqual([1]);
  });

  it("keeps optional participants out of the classification but records them", () => {
    const participants = participantsOf([ivan], [anna]);
    const segments = buildGroupTimeline(participants, [
      availability(ivan, "known", [], RANGE),
      availability(anna, "known", [busy(DAY + 10 * HOUR, DAY + 11 * HOUR)], RANGE),
    ], RANGE);

    const conflicted = segments.find((segment) => segment.start === DAY + 10 * HOUR);
    expect(conflicted?.classification).toBe("confirmed");
    expect(conflicted?.optionalBusy).toEqual([1]);
    expect(conflicted?.requiredFree).toEqual([0]);
  });

  it("marks segments unknown when a required participant has no trustworthy data", () => {
    const participants = participantsOf([ivan, petr]);
    const segments = buildGroupTimeline(participants, [
      availability(ivan, "known", [], RANGE),
      availability(petr, "unsupported", [], RANGE),
    ], RANGE);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.classification).toBe("unknown");
    expect(segments[0]?.requiredUnknown).toEqual([1]);
    expect(segments[0]?.requiredFree).toEqual([0]);
  });

  it("separates tentative from hard busy", () => {
    const participants = participantsOf([ivan]);
    const segments = buildGroupTimeline(participants, [
      availability(ivan, "known", [tentative(DAY + 10 * HOUR, DAY + 11 * HOUR)], RANGE),
    ], RANGE);

    const soft = segments.find((segment) => segment.start === DAY + 10 * HOUR);
    expect(soft?.classification).toBe("possible");
    expect(soft?.requiredTentative).toEqual([0]);
    expect(soft?.requiredBusy).toEqual([]);
  });
});
