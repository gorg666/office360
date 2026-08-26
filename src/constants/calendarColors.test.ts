import { describe, expect, it } from "vitest";
import {
  CALENDAR_PALETTE,
  MIN_TEXT_CONTRAST,
  calendarColorSet,
  calendarMarker,
  contrastRatio,
  hashToIndex,
  parseHex,
} from "./calendarColors";

const rgb = (hex: string) => parseHex(hex)!;

describe("calendarColors", () => {
  describe("parseHex", () => {
    it("parses 6-digit, 3-digit and hash-less forms", () => {
      expect(parseHex("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
      expect(parseHex("#f00")).toEqual({ r: 255, g: 0, b: 0 });
      expect(parseHex("00ff00")).toEqual({ r: 0, g: 255, b: 0 });
    });

    it("drops a provider alpha channel rather than rejecting the colour", () => {
      expect(parseHex("#2e90fa80")).toEqual(parseHex("#2e90fa"));
    });

    it("returns null for missing or malformed values", () => {
      for (const value of [null, undefined, "", "  ", "nope", "#12345", "#gggggg"]) {
        expect(parseHex(value)).toBeNull();
      }
    });
  });

  describe("hashToIndex", () => {
    it("is deterministic and stays in range", () => {
      for (const id of ["a", "cal-1", "primary@example.com", ""]) {
        const first = hashToIndex(id, CALENDAR_PALETTE.length);
        expect(hashToIndex(id, CALENDAR_PALETTE.length)).toBe(first);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThan(CALENDAR_PALETTE.length);
      }
    });

    it("spreads distinct ids across more than one bucket", () => {
      const ids = Array.from({ length: 40 }, (_, i) => `calendar-${i}`);
      const used = new Set(ids.map((id) => hashToIndex(id, CALENDAR_PALETTE.length)));
      expect(used.size).toBeGreaterThan(1);
    });
  });

  describe("calendarColorSet", () => {
    it("uses the provider colour as the marker when one is supplied", () => {
      expect(calendarColorSet({ id: "c1", color: "#2e90fa" }, false).marker).toBe("#2e90fa");
    });

    it("falls back to a stable palette hue when the provider sends none", () => {
      const a = calendarColorSet({ id: "c1" }, false);
      const b = calendarColorSet({ id: "c1", color: null }, false);
      const c = calendarColorSet({ id: "c1", color: "not-a-colour" }, false);
      expect(a.marker).toBe(b.marker);
      expect(a.marker).toBe(c.marker);
      expect(CALENDAR_PALETTE).toContain(a.marker);
    });

    it("gives different calendars different fills", () => {
      const one = calendarColorSet({ id: "cal-a", color: "#2e90fa" }, false);
      const two = calendarColorSet({ id: "cal-b", color: "#d92d20" }, false);
      expect(one.fill).not.toBe(two.fill);
      expect(one.marker).not.toBe(two.marker);
    });

    it("produces a different material in dark mode for the same calendar", () => {
      const light = calendarColorSet({ id: "c1", color: "#2e90fa" }, false);
      const dark = calendarColorSet({ id: "c1", color: "#2e90fa" }, true);
      expect(light.fill).not.toBe(dark.fill);
      expect(light.text).not.toBe(dark.text);
      expect(light.marker).toBe(dark.marker);
    });

    // The point of the module: arbitrary provider colours must stay readable.
    it("clears AA contrast for text on fill, in both themes, for the whole palette", () => {
      for (const colour of CALENDAR_PALETTE) {
        for (const dark of [false, true]) {
          const set = calendarColorSet({ id: "x", color: colour }, dark);
          expect(contrastRatio(rgb(set.text), rgb(set.fill))).toBeGreaterThanOrEqual(
            MIN_TEXT_CONTRAST,
          );
        }
      }
    });

    it("clears AA contrast for hostile provider colours too", () => {
      const hostile = ["#ffffff", "#000000", "#ffff00", "#00ffff", "#7f7f7f", "#fefefe"];
      for (const colour of hostile) {
        for (const dark of [false, true]) {
          const set = calendarColorSet({ id: "x", color: colour }, dark);
          expect(
            contrastRatio(rgb(set.text), rgb(set.fill)),
            `${colour} dark=${dark}`,
          ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        }
      }
    });

    it("returns well-formed hex for every channel", () => {
      const set = calendarColorSet({ id: "c1", color: "#2e90fa" }, false);
      for (const value of [set.marker, set.fill, set.border, set.text]) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/);
      }
    });
  });

  describe("calendarMarker", () => {
    it("agrees with calendarColorSet", () => {
      for (const source of [{ id: "a", color: "#079455" }, { id: "b" }]) {
        expect(calendarMarker(source)).toBe(calendarColorSet(source, false).marker);
      }
    });
  });
});
