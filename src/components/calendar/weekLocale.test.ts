import { describe, expect, it } from "vitest";
import {
  endOfWeek,
  monthGridRange,
  monthGridStartOffset,
  hourGutterLabel,
  orderedDayNames,
  startOfWeek,
  weekStartsOnMonday,
} from "./weekLocale";

describe("weekLocale", () => {
  it("starts week on Monday for RU and Sunday for EN", () => {
    expect(weekStartsOnMonday("ru")).toBe(true);
    expect(weekStartsOnMonday("en")).toBe(false);
  });

  it("orders RU day headers Monday-first", () => {
    expect(orderedDayNames("ru")).toEqual(["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]);
    expect(orderedDayNames("en")).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });

  it("computes month grid offset for August 2026", () => {
    const first = new Date(2026, 7, 1);
    expect(monthGridStartOffset(first, "en")).toBe(6);
    expect(monthGridStartOffset(first, "ru")).toBe(5);
  });

  it("aligns week boundaries to Monday for RU", () => {
    const wednesday = new Date(2026, 7, 26);
    const start = startOfWeek(wednesday, "ru");
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(24);
    const end = endOfWeek(wednesday, "ru");
    expect(end.getDay()).toBe(0);
    expect(end.getDate()).toBe(30);
  });

  it("keeps Sunday-first week boundaries for EN", () => {
    const wednesday = new Date(2026, 7, 26);
    const start = startOfWeek(wednesday, "en");
    expect(start.getDay()).toBe(0);
    expect(start.getDate()).toBe(23);
  });

  it("builds month grid range with spillover padding", () => {
    const august = new Date(2026, 7, 15);
    const ruRange = monthGridRange(august, "ru");
    expect(ruRange.start.getDate()).toBe(27);
    expect(ruRange.start.getMonth()).toBe(6);
    expect(ruRange.end.getDate()).toBe(6);
    expect(ruRange.end.getMonth()).toBe(8);
  });
});

describe("hourGutterLabel", () => {
  it("renders 24-hour labels in RU — the gutter used to show English am/pm", () => {
    expect(hourGutterLabel(13, "ru")).toBe("13");
    expect(hourGutterLabel(1, "ru")).toBe("1");
    expect(hourGutterLabel(23, "ru")).toBe("23");
    for (let hour = 1; hour < 24; hour += 1) {
      expect(hourGutterLabel(hour, "ru")).not.toMatch(/am|pm/i);
    }
  });

  it("keeps 12-hour labels in EN", () => {
    expect(hourGutterLabel(13, "en")).toMatch(/^1\s?PM$/i);
    expect(hourGutterLabel(9, "en")).toMatch(/^9\s?AM$/i);
  });

  it("labels midnight as empty in both locales", () => {
    expect(hourGutterLabel(0, "ru")).toBe("");
    expect(hourGutterLabel(0, "en")).toBe("");
  });
});
