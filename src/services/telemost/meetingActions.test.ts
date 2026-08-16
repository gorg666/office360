import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), cefNavigate: vi.fn(), openBrowser: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/cef", () => ({ cefNavigate: mocks.cefNavigate }));
vi.mock("./meetingRenderer", () => ({
  openTelemostCreateInBrowser: mocks.openBrowser,
  TELEMOST_CREATE_URL: "https://telemost.yandex.ru/?browser-auto-create=1",
}));
import { createTelemostMeetingWeb } from "./meetingActions";

beforeEach(() => vi.clearAllMocks());
describe("createTelemostMeetingWeb", () => {
  const BOUNDS = { x: 120, y: 80, width: 900, height: 640 };
  it("uses the existing Windows CEF create route", async () => { expect(await createTelemostMeetingWeb("windows")).toBe("cef"); expect(mocks.cefNavigate).toHaveBeenCalledWith("https://telemost.yandex.ru/?browser-auto-create=1"); });
  it("uses the account-scoped macOS embedded WKWebView", async () => {
    expect(await createTelemostMeetingWeb("macos", "account-1", BOUNDS)).toBe("wkwebview");
    expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: "https://telemost.yandex.ru/?browser-auto-create=1",
      accountKey: "account-1",
      bounds: BOUNDS,
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_create", expect.anything());
    expect(mocks.cefNavigate).not.toHaveBeenCalled();
    expect(mocks.openBrowser).not.toHaveBeenCalled();
  });
  it("requires embedded bounds on macOS", async () => {
    await expect(createTelemostMeetingWeb("macos", "account-1")).rejects.toThrow("bounds are unavailable");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("uses browser only for other platforms", async () => { expect(await createTelemostMeetingWeb("other")).toBe("browser"); expect(mocks.openBrowser).toHaveBeenCalled(); });
});
