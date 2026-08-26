import { describe, it, expect } from "vitest";
import {
  COLOR_THEMES,
  DEFAULT_COLOR_THEME,
  getThemeById,
} from "./themes";

describe("themes", () => {
  it("all themes have unique IDs", () => {
    const ids = COLOR_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all themes have complete light and dark color sets", () => {
    const requiredKeys = ["accent", "accentHover", "accentLight", "bgSelected", "sidebarActive"];
    for (const theme of COLOR_THEMES) {
      for (const key of requiredKeys) {
        expect(theme.light).toHaveProperty(key);
        expect(theme.light[key as keyof typeof theme.light]).toBeTruthy();
        expect(theme.dark).toHaveProperty(key);
        expect(theme.dark[key as keyof typeof theme.dark]).toBeTruthy();
      }
    }
  });

  it("DEFAULT_COLOR_THEME is the Office360 brand accent", () => {
    expect(DEFAULT_COLOR_THEME).toBe("office360");
  });

  it("keeps neutral available as an explicit grey choice", () => {
    const neutral = getThemeById("neutral");
    expect(neutral.id).toBe("neutral");
    expect(neutral.light.accent).toBe("#525252");
  });

  it("getThemeById returns correct theme", () => {
    const rose = getThemeById("rose");
    expect(rose.id).toBe("rose");
    expect(rose.name).toBe("Rose");

    const emerald = getThemeById("emerald");
    expect(emerald.id).toBe("emerald");
  });

  it("getThemeById falls back to the default theme for unknown ID", () => {
    const fallback = getThemeById("nonexistent");
    expect(fallback.id).toBe(DEFAULT_COLOR_THEME);
  });
});
