import { beforeEach, describe, expect, it, vi } from "vitest";

const os = vi.hoisted(() => ({ platform: vi.fn() }));

vi.mock("@tauri-apps/plugin-os", () => ({ platform: os.platform }));

import { getDesktopPlatform, resetDesktopPlatformCacheForTests } from "./desktopPlatform";

beforeEach(() => {
  vi.clearAllMocks();
  resetDesktopPlatformCacheForTests();
});

describe("getDesktopPlatform", () => {
  it.each([
    ["windows", "windows"],
    ["macos", "macos"],
    ["linux", "other"],
  ] as const)("maps %s to %s", async (host, expected) => {
    os.platform.mockResolvedValue(host);
    await expect(getDesktopPlatform()).resolves.toBe(expected);
  });

  it("falls back to other when OS detection is unavailable", async () => {
    os.platform.mockRejectedValue(new Error("unavailable"));
    await expect(getDesktopPlatform()).resolves.toBe("other");
  });
});
