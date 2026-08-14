import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), openUrl: vi.fn(), cefNavigate: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@/services/cef", () => ({ cefNavigate: mocks.cefNavigate }));
import { closeTelemostEmbedded, openTelemostMeeting, setTelemostEmbeddedBounds } from "./meetingRenderer";

const URL = "https://telemost.yandex.ru/j/123456789";
const BOUNDS = { x: 120, y: 80, width: 900, height: 640 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockResolvedValue(undefined);
});

describe("openTelemostMeeting", () => {
  it("routes Windows to CEF", async () => {
    expect(await openTelemostMeeting("windows", URL)).toBe("cef");
    expect(mocks.cefNavigate).toHaveBeenCalledWith(URL);
  });

  it("routes macOS to an embedded child WKWebView when bounds are provided", async () => {
    expect(await openTelemostMeeting("macos", URL, "account-1", BOUNDS)).toBe("wkwebview-embedded");
    expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: URL,
      accountKey: "account-1",
      bounds: BOUNDS,
    });
  });

  it("falls back to standalone WKWebView when embedded creation fails", async () => {
    mocks.invoke
      .mockRejectedValueOnce(new Error("child unavailable"))
      .mockResolvedValueOnce(undefined);
    expect(await openTelemostMeeting("macos", URL, "account-1", BOUNDS)).toBe("wkwebview");
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "open_telemost_macos_embedded", {
      url: URL,
      accountKey: "account-1",
      bounds: BOUNDS,
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "open_telemost_macos_spike", {
      url: URL,
      accountKey: "account-1",
    });
  });

  it("routes other platforms to the browser", async () => {
    expect(await openTelemostMeeting("other", URL)).toBe("browser");
    expect(mocks.openUrl).toHaveBeenCalledWith(URL);
  });
});

describe("embedded Telemost helpers", () => {
  it("propagates bounds updates and destroys the child surface", async () => {
    await setTelemostEmbeddedBounds(BOUNDS);
    await closeTelemostEmbedded();
    expect(mocks.invoke).toHaveBeenCalledWith("set_telemost_macos_embedded_bounds", { bounds: BOUNDS });
    expect(mocks.invoke).toHaveBeenCalledWith("close_telemost_macos_embedded");
  });
});
