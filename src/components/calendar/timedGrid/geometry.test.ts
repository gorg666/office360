import { describe, expect, it } from "vitest";
import { DRAG_THRESHOLD_PX, MINUTES_PER_DAY, SNAP_MINUTES } from "./constants";
import {
  clampDurationMinutes,
  hitTestDayIndex,
  minutesToY,
  pointerExceedsDragThreshold,
  snapMinutes,
  splitWeekMinutes,
  weekMinutes,
  weekRangeSegments,
  yToMinutes,
} from "./geometry";

describe("timed-grid geometry", () => {
  it("snaps to the shared 15-minute grid", () => {
    expect(SNAP_MINUTES).toBe(15);
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(22)).toBe(15);
    expect(snapMinutes(23)).toBe(30);
    expect(snapMinutes(90)).toBe(90);
  });

  it("converts pointer Y through hour height without extra snap policies", () => {
    expect(yToMinutes(72, 48)).toBe(90);
    expect(minutesToY(90, 48)).toBe(72);
    expect(snapMinutes(yToMinutes(70, 48))).toBe(90);
  });

  it("maps week columns to absolute minutes and back", () => {
    expect(weekMinutes(1, 11 * 60 + 30)).toBe(MINUTES_PER_DAY + 690);
    expect(splitWeekMinutes(MINUTES_PER_DAY + 690)).toEqual({ dayIndex: 1, minutesOnDay: 690 });
  });

  it("splits a cross-midnight range into day segments", () => {
    expect(weekRangeSegments(22 * 60, 26 * 60)).toEqual([
      { dayIndex: 0, top: 22 * 60, duration: 120 },
      { dayIndex: 1, top: 0, duration: 120 },
    ]);
  });

  it("hit-tests week columns from overlay X", () => {
    expect(hitTestDayIndex(10, 700, 7)).toBe(0);
    expect(hitTestDayIndex(150, 700, 7)).toBe(1);
    expect(hitTestDayIndex(699, 700, 7)).toBe(6);
  });

  it("requires a movement threshold before a gesture becomes a drag", () => {
    expect(DRAG_THRESHOLD_PX).toBe(6);
    expect(pointerExceedsDragThreshold(3, 3)).toBe(false);
    expect(pointerExceedsDragThreshold(6, 0)).toBe(true);
  });

  it("clamps inverted ranges to the minimum duration", () => {
    expect(clampDurationMinutes(600, 590)).toEqual({ start: 600, end: 615 });
    expect(clampDurationMinutes(600, 700)).toEqual({ start: 600, end: 700 });
  });
});
