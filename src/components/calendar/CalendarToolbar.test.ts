import { describe, expect, it } from "vitest";
import { formatCalendarToolbarTitle } from "./CalendarToolbar";

describe("formatCalendarToolbarTitle", () => {
  it("formats Russian month titles with title case and year suffix", () => {
    const title = formatCalendarToolbarTitle(new Date(2026, 7, 15), "month", "ru");
    expect(title).toMatch(/^Август 2026/);
    expect(title).toContain("г");
    expect(title).not.toBe(title.toLocaleUpperCase("ru-RU"));
  });

  it("formats all 12 Russian months without clipping the first letter", () => {
    for (let month = 0; month < 12; month += 1) {
      const title = formatCalendarToolbarTitle(new Date(2026, month, 1), "month", "ru");
      const first = [...title][0] ?? "";
      expect(first).toBe(first.toLocaleUpperCase("ru-RU"));
      expect(title).toMatch(/\d{4}/);
      expect(title).not.toMatch(/^[а-я]/);
    }
  });

  it("keeps English month titles title-cased via Intl", () => {
    const title = formatCalendarToolbarTitle(new Date(2026, 7, 15), "month", "en");
    expect(title).toMatch(/^August 2026/);
  });

  it("formats RU week titles from Monday through Sunday", () => {
    const title = formatCalendarToolbarTitle(new Date(2026, 7, 26), "week", "ru");
    expect(title).toBe("24-30 август 2026");
  });

  it("formats EN week titles from Sunday through Saturday", () => {
    const title = formatCalendarToolbarTitle(new Date(2026, 7, 26), "week", "en");
    expect(title).toBe("August 23-29, 2026");
  });

  it("updates year when navigating across year boundary", () => {
    expect(formatCalendarToolbarTitle(new Date(2025, 11, 1), "month", "ru")).toMatch(/2025/);
    expect(formatCalendarToolbarTitle(new Date(2026, 0, 1), "month", "ru")).toMatch(/2026/);
  });
});
