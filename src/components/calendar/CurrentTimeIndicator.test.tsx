import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WEEK_HOUR_HEIGHT_PX } from "./timedGrid/constants";
import { CurrentTimeIndicator } from "./CurrentTimeIndicator";

describe("CurrentTimeIndicator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders on the visible today column", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T09:30:00Z"));
    const today = new Date(2026, 7, 24);
    render(
      <CurrentTimeIndicator
        days={[today]}
        hourHeightPx={WEEK_HOUR_HEIGHT_PX}
        displayTimeZone="UTC"
      />,
    );
    const indicator = screen.getByTestId("current-time-indicator");
    expect(indicator).toBeInTheDocument();
    expect(indicator.style.top).toBe(`${(570 / 60) * WEEK_HOUR_HEIGHT_PX}px`);
    expect(indicator.style.left).toBe("0%");
  });

  it("hides when today is outside the visible day range", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T09:30:00Z"));
    const tomorrow = new Date(2026, 7, 25);
    render(
      <CurrentTimeIndicator
        days={[tomorrow]}
        hourHeightPx={WEEK_HOUR_HEIGHT_PX}
        displayTimeZone="UTC"
      />,
    );
    expect(screen.queryByTestId("current-time-indicator")).toBeNull();
  });
});
