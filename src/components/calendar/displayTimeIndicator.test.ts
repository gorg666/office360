import { afterEach, describe, expect, it, vi } from "vitest";
import { WEEK_HOUR_HEIGHT_PX } from "./timedGrid/constants";
import {
  currentTimeTopPx,
  indexOfTodayColumn,
  isTodayInDisplayTimeZone,
  nowInDisplayTimeZone,
} from "./displayTimeIndicator";

describe("displayTimeIndicator helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives now from display timezone, not host offset assumptions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T09:30:00Z"));
    expect(nowInDisplayTimeZone("UTC")).toMatchObject({ hour: 9, minute: 30 });
    expect(nowInDisplayTimeZone("Europe/Moscow")).toMatchObject({ hour: 12, minute: 30 });
  });

  it("positions the indicator from wall-clock minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T10:15:00Z"));
    const top = currentTimeTopPx("UTC", WEEK_HOUR_HEIGHT_PX);
    expect(top).toBe((615 / 60) * WEEK_HOUR_HEIGHT_PX);
  });

  it("finds today column only when visible", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00Z"));
    const today = new Date(2026, 7, 24);
    const tomorrow = new Date(2026, 7, 25);
    expect(indexOfTodayColumn([today], "UTC")).toBe(0);
    expect(indexOfTodayColumn([tomorrow], "UTC")).toBe(-1);
    expect(isTodayInDisplayTimeZone(today, "UTC")).toBe(true);
    expect(isTodayInDisplayTimeZone(tomorrow, "UTC")).toBe(false);
  });
});
