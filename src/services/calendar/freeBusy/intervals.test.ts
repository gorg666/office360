import { describe, expect, it } from "vitest";
import {
  availabilityStateAt,
  availabilityStateForInterval,
  canReportFree,
  clipBusyInterval,
  invertBusyIntervals,
  mergeBusyIntervals,
} from "./intervals";
import type { BusyInterval, ParticipantAvailability } from "./types";

const H = 3600;
const busy = (start: number, end: number): BusyInterval => ({ start, end, busyType: "busy" });
const tentative = (start: number, end: number): BusyInterval => ({ start, end, busyType: "tentative" });

function availability(
  reliability: ParticipantAvailability["reliability"],
  intervals: BusyInterval[],
): ParticipantAvailability {
  return {
    participant: { kind: "email", value: "a@b.test", normalizedEmail: "a@b.test" },
    reliability, source: "local-cache", busy: intervals,
    range: { start: 0, end: 24 * H }, timeZone: "UTC",
    observedAt: 0, dataAsOf: null, diagnostics: [],
  };
}

describe("free/busy interval algebra", () => {
  it("merges overlapping intervals of the same type", () => {
    expect(mergeBusyIntervals([busy(10 * H, 11 * H), busy(10.5 * H, 12 * H)]))
      .toEqual([busy(10 * H, 12 * H)]);
  });

  it("merges intervals that are exactly adjacent and share a type", () => {
    expect(mergeBusyIntervals([busy(10 * H, 11 * H), busy(11 * H, 12 * H)]))
      .toEqual([busy(10 * H, 12 * H)]);
  });

  it("keeps adjacent intervals separate when the busy type differs", () => {
    expect(mergeBusyIntervals([busy(10 * H, 11 * H), tentative(11 * H, 12 * H)]))
      .toEqual([busy(10 * H, 11 * H), tentative(11 * H, 12 * H)]);
  });

  it("lets hard busy win only over the overlapping portion of a tentative interval", () => {
    expect(mergeBusyIntervals([tentative(10 * H, 13 * H), busy(11 * H, 12 * H)]))
      .toEqual([
        tentative(10 * H, 11 * H),
        busy(11 * H, 12 * H),
        tentative(12 * H, 13 * H),
      ]);
  });

  it("merges tentative with tentative and drops zero-length or inverted intervals", () => {
    expect(mergeBusyIntervals([tentative(10 * H, 11 * H), tentative(10 * H, 11 * H)]))
      .toEqual([tentative(10 * H, 11 * H)]);
    expect(mergeBusyIntervals([busy(10 * H, 10 * H), busy(12 * H, 11 * H)])).toEqual([]);
  });

  it("clips intervals to the requested range", () => {
    expect(clipBusyInterval(busy(8 * H, 15 * H), { start: 10 * H, end: 12 * H }))
      .toEqual(busy(10 * H, 12 * H));
    expect(clipBusyInterval(busy(8 * H, 9 * H), { start: 10 * H, end: 12 * H })).toBeNull();
    expect(mergeBusyIntervals([busy(8 * H, 15 * H)], { start: 10 * H, end: 12 * H }))
      .toEqual([busy(10 * H, 12 * H)]);
  });

  it("inverts busy time into free gaps inside the range", () => {
    expect(invertBusyIntervals({ start: 9 * H, end: 13 * H }, [busy(10 * H, 11 * H)]))
      .toEqual([{ start: 9 * H, end: 10 * H }, { start: 11 * H, end: 13 * H }]);
    expect(invertBusyIntervals({ start: 9 * H, end: 13 * H }, [busy(8 * H, 14 * H)])).toEqual([]);
    expect(invertBusyIntervals({ start: 9 * H, end: 9 * H }, [])).toEqual([]);
  });
});

describe("availability state never invents free time", () => {
  it("reports free only when the answer is fully reliable", () => {
    expect(availabilityStateAt(availability("known", []), 10 * H)).toBe("free");
    expect(availabilityStateAt(availability("partial", []), 10 * H)).toBe("unknown");
    expect(availabilityStateAt(availability("unknown", []), 10 * H)).toBe("unknown");
    expect(availabilityStateAt(availability("unsupported", []), 10 * H)).toBe("unknown");
    expect(availabilityStateAt(availability("permission-denied", []), 10 * H)).toBe("unknown");
    expect(availabilityStateAt(availability("error", []), 10 * H)).toBe("unknown");
  });

  it("reports busy from intervals even when reliability is only partial", () => {
    const partial = availability("partial", [busy(10 * H, 11 * H)]);
    expect(availabilityStateAt(partial, 10.5 * H)).toBe("busy");
    expect(availabilityStateAt(partial, 11 * H)).toBe("unknown");
  });

  it("treats the interval as half-open", () => {
    const known = availability("known", [busy(10 * H, 11 * H)]);
    expect(availabilityStateAt(known, 10 * H)).toBe("busy");
    expect(availabilityStateAt(known, 11 * H)).toBe("free");
  });

  it("prefers busy over tentative across a queried interval", () => {
    const mixed = availability("known", [tentative(10 * H, 11 * H), busy(11 * H, 12 * H)]);
    expect(availabilityStateForInterval(mixed, { start: 10 * H, end: 12 * H })).toBe("busy");
    expect(availabilityStateForInterval(mixed, { start: 10 * H, end: 11 * H })).toBe("tentative");
    expect(availabilityStateForInterval(mixed, { start: 12 * H, end: 13 * H })).toBe("free");
    expect(availabilityStateForInterval(availability("partial", []), { start: 12 * H, end: 13 * H }))
      .toBe("unknown");
  });

  it("exposes an explicit guard for presenting free time", () => {
    expect(canReportFree(availability("known", []))).toBe(true);
    expect(canReportFree(availability("partial", []))).toBe(false);
  });
});
