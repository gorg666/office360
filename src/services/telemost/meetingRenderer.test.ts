import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), openUrl: vi.fn(), cefNavigate: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@/services/cef", () => ({ cefNavigate: mocks.cefNavigate }));
import { openTelemostMeeting } from "./meetingRenderer";

const URL = "https://telemost.yandex.ru/j/123456789";
beforeEach(() => vi.clearAllMocks());

describe("openTelemostMeeting", () => {
  it("routes Windows to CEF", async () => { expect(await openTelemostMeeting("windows", URL)).toBe("cef"); expect(mocks.cefNavigate).toHaveBeenCalledWith(URL); });
  it("routes macOS to an account-scoped WKWebView", async () => { expect(await openTelemostMeeting("macos", URL, "account-1")).toBe("wkwebview"); expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_spike", { url: URL, accountKey: "account-1" }); });
  it("routes other platforms to the browser", async () => { expect(await openTelemostMeeting("other", URL)).toBe("browser"); expect(mocks.openUrl).toHaveBeenCalledWith(URL); });
});
