import { describe, expect, it } from "vitest";
import { computeTokenExpiresAtSeconds } from "./tokenExpiry";

describe("computeTokenExpiresAtSeconds", () => {
  const now = 1_700_000_000;

  it("adds relative TTL in seconds", () => {
    expect(computeTokenExpiresAtSeconds(3600, now)).toBe(now + 3600);
  });

  it("keeps one-year relative TTL", () => {
    expect(computeTokenExpiresAtSeconds(31_536_000, now)).toBe(now + 31_536_000);
  });

  it("clamps absurd relative/doc-example magnitudes", () => {
    const max = 400 * 24 * 60 * 60;
    expect(computeTokenExpiresAtSeconds(124_234_123_534, now)).toBe(now + max);
  });

  it("accepts absolute unix seconds near now", () => {
    expect(computeTokenExpiresAtSeconds(now + 86_400, now)).toBe(now + 86_400);
  });

  it("accepts absolute unix milliseconds near now", () => {
    expect(computeTokenExpiresAtSeconds((now + 86_400) * 1000, now)).toBe(now + 86_400);
  });

  it("falls back for invalid values", () => {
    expect(computeTokenExpiresAtSeconds(0, now)).toBe(now + 3600);
    expect(computeTokenExpiresAtSeconds(Number.NaN, now)).toBe(now + 3600);
  });
});
