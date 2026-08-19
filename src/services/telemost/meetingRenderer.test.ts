import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), openUrl: vi.fn(), cefNavigate: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@/services/cef", () => ({ cefNavigate: mocks.cefNavigate }));
import { closeTelemostEmbedded, isTelemostCreateUrl, isTelemostJoinUrl, openTelemostEmbedded, openTelemostMeeting, setTelemostEmbeddedBounds, TELEMOST_CREATE_URL } from "./meetingRenderer";

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
    expect(mocks.cefNavigate).not.toHaveBeenCalled();
  });

  it("does not escape to a standalone window when child creation fails", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("child unavailable"));
    await expect(openTelemostMeeting("macos", URL, "account-1", BOUNDS)).rejects.toThrow("child unavailable");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("requires child-view bounds on macOS", async () => {
    await expect(openTelemostMeeting("macos", URL, "account-1")).rejects.toThrow("bounds are unavailable");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("refuses to open a WK surface without a real account key", async () => {
    await expect(openTelemostMeeting("macos", URL, undefined, BOUNDS)).rejects.toThrow("account profile is unavailable");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("routes other platforms to the browser", async () => {
    expect(await openTelemostMeeting("other", URL)).toBe("browser");
    expect(mocks.openUrl).toHaveBeenCalledWith(URL);
  });
});

describe("openTelemostEmbedded create surface", () => {
  it("accepts the official Telemost create URL", () => {
    expect(isTelemostCreateUrl(TELEMOST_CREATE_URL)).toBe(true);
    expect(isTelemostCreateUrl("https://telemost.yandex.ru/")).toBe(true);
    expect(isTelemostCreateUrl("https://telemost.360.yandex.ru/?office360-auth-check=1")).toBe(true);
    expect(isTelemostCreateUrl(URL)).toBe(false);
    expect(isTelemostJoinUrl("https://telemost.yandex.ru/j/98543805636845?browser-auto-create=1")).toBe(true);
    expect(isTelemostCreateUrl("https://telemost.yandex.ru/j/98543805636845?browser-auto-create=1")).toBe(false);
  });

  it("opens the macOS create UI in the same embedded child WKWebView", async () => {
    expect(await openTelemostEmbedded("macos", TELEMOST_CREATE_URL, "account-1", BOUNDS)).toBe("wkwebview-embedded");
    expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: TELEMOST_CREATE_URL,
      accountKey: "account-1",
      bounds: BOUNDS,
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_create", expect.anything());
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
