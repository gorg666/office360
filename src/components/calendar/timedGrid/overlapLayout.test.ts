import { describe, expect, it } from "vitest";
import { packOverlappingEvents } from "./overlapLayout";

describe("packOverlappingEvents", () => {
  it("keeps isolated events in a single column", () => {
    expect(packOverlappingEvents([
      { id: "a", start: 600, end: 660 },
      { id: "b", start: 700, end: 760 },
    ])).toEqual([
      { id: "a", column: 0, columnCount: 1 },
      { id: "b", column: 0, columnCount: 1 },
    ]);
  });

  it("recomputes overlap columns for concurrent events", () => {
    const packed = packOverlappingEvents([
      { id: "a", start: 600, end: 660 },
      { id: "b", start: 630, end: 690 },
      { id: "c", start: 800, end: 860 },
    ]);
    expect(packed.find((item) => item.id === "a")).toEqual({ id: "a", column: 0, columnCount: 2 });
    expect(packed.find((item) => item.id === "b")).toEqual({ id: "b", column: 1, columnCount: 2 });
    expect(packed.find((item) => item.id === "c")).toEqual({ id: "c", column: 0, columnCount: 1 });
  });

  it("does not leave stale column counts after events no longer overlap", () => {
    const overlapping = packOverlappingEvents([
      { id: "a", start: 600, end: 720 },
      { id: "b", start: 600, end: 720 },
    ]);
    expect(overlapping.every((item) => item.columnCount === 2)).toBe(true);

    const afterMove = packOverlappingEvents([
      { id: "a", start: 600, end: 660 },
      { id: "b", start: 900, end: 960 },
    ]);
    expect(afterMove.every((item) => item.columnCount === 1)).toBe(true);
  });
});
