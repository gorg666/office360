import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const setBadgeCount = vi.fn();
const getByLabel = vi.fn();
const getCurrentWindow = vi.fn();
const getUnreadInboxCount = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/window", () => ({
  Window: { getByLabel: (...args: unknown[]) => getByLabel(...args) },
  getCurrentWindow: () => getCurrentWindow(),
}));
vi.mock("./db/threads", () => ({ getUnreadInboxCount: () => getUnreadInboxCount() }));
vi.mock("@/i18n", () => ({ APP_NAME_EN: "Office360" }));

import { dockBadgeCount, resetBadgeCountCache, updateBadgeCount } from "./badgeManager";

describe("dock badge", () => {
  beforeEach(() => {
    resetBadgeCountCache();
    invoke.mockReset();
    setBadgeCount.mockReset();
    getByLabel.mockReset();
    getCurrentWindow.mockReset();
    getUnreadInboxCount.mockReset();
    invoke.mockResolvedValue(undefined);
    getByLabel.mockResolvedValue({ setBadgeCount });
    getCurrentWindow.mockReturnValue({ setBadgeCount });
  });

  it("clears the native badge at zero unread", () => {
    expect(dockBadgeCount(0)).toBeUndefined();
  });

  it("shows the unread inbox count when nonzero", () => {
    expect(dockBadgeCount(12)).toBe(12);
  });

  it("sets the dock badge through the main-window rust command", async () => {
    getUnreadInboxCount.mockResolvedValue(3);
    await updateBadgeCount();
    expect(invoke).toHaveBeenCalledWith("set_dock_badge_count", { count: 3 });
    expect(invoke).toHaveBeenCalledWith("set_tray_tooltip", { tooltip: "Office360 - 3 unread" });
  });

  it("clears the dock badge when unread returns to zero", async () => {
    getUnreadInboxCount.mockResolvedValueOnce(2);
    await updateBadgeCount();
    getUnreadInboxCount.mockResolvedValueOnce(0);
    await updateBadgeCount();
    expect(invoke).toHaveBeenLastCalledWith("set_tray_tooltip", { tooltip: "Office360" });
    expect(invoke).toHaveBeenCalledWith("set_dock_badge_count", { count: null });
  });

  it("falls back to the main window API when rust is unavailable", async () => {
    invoke.mockRejectedValue(new Error("no rust"));
    getUnreadInboxCount.mockResolvedValue(5);
    await updateBadgeCount();
    expect(getByLabel).toHaveBeenCalledWith("main");
    expect(setBadgeCount).toHaveBeenCalledWith(5);
  });

  it("does not call the window fallback when the rust command succeeds", async () => {
    getUnreadInboxCount.mockResolvedValue(4);
    await updateBadgeCount();
    expect(invoke).toHaveBeenCalledWith("set_dock_badge_count", { count: 4 });
    expect(getByLabel).not.toHaveBeenCalled();
    expect(setBadgeCount).not.toHaveBeenCalled();
  });
});
