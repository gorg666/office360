import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isGranted: vi.fn(),
  request: vi.fn(),
  send: vi.fn(),
  register: vi.fn(),
  onAction: vi.fn(),
  getSetting: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: mocks.isGranted,
  requestPermission: mocks.request,
  sendNotification: mocks.send,
  registerActionTypes: mocks.register,
  onAction: mocks.onAction,
}));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: vi.fn().mockResolvedValue("linux") }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getByLabel: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../db/settings", () => ({ getSetting: mocks.getSetting }));
vi.mock("../../stores/composerStore", () => ({ useComposerStore: { getState: () => ({ openComposer: vi.fn() }) } }));
vi.mock("../../router/navigate", () => ({ navigateToLabel: vi.fn() }));
vi.mock("@/utils/emailUtils", () => ({ normalizeEmail: (value: string) => value.trim().toLowerCase() }));
vi.mock("@/i18n", () => ({
  APP_NAME_RU: "Office360",
  getInitialLocale: () => "en",
  translateText: (value: string) => value,
}));
vi.mock("@/utils/pluralRu", () => ({ pluralRu: () => "emails" }));

describe("Calendar notification permission handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getSetting.mockImplementation(async (key: string) => key === "notifications_enabled" ? "true" : null);
    mocks.register.mockResolvedValue(undefined);
    mocks.onAction.mockResolvedValue({ unregister: vi.fn() });
  });

  it("returns permission-denied without throwing or sending", async () => {
    mocks.isGranted.mockResolvedValue(false);
    mocks.request.mockResolvedValue("denied");
    const manager = await import("./notificationManager");
    await expect(manager.initNotifications()).resolves.toBe("denied");
    await expect(manager.showCalendarReminderNotification({ title: "A", body: "B" }))
      .resolves.toEqual({ status: "permission-denied", permission: "denied" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("delivers a privacy-filtered Calendar payload when granted", async () => {
    mocks.isGranted.mockResolvedValue(true);
    const manager = await import("./notificationManager");
    await manager.initNotifications();
    await expect(manager.showCalendarReminderNotification({ title: "Calendar reminder", body: "Busy event" }))
      .resolves.toEqual({ status: "delivered", permission: "granted" });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      title: "Calendar reminder",
      body: "Busy event",
      actionTypeId: "calendar-reminder",
    }));
  });

  it("keeps an unavailable permission API in unknown state", async () => {
    mocks.isGranted.mockRejectedValue(new Error("not available"));
    const manager = await import("./notificationManager");
    await expect(manager.initNotifications()).resolves.toBe("unknown");
    await expect(manager.showCalendarReminderNotification({ title: "A", body: "B" }))
      .resolves.toEqual({ status: "failed", permission: "unknown" });
  });
});
