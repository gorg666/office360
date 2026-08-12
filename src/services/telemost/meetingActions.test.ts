import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), cefNavigate: vi.fn(), openBrowser: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/cef", () => ({ cefNavigate: mocks.cefNavigate }));
vi.mock("./meetingRenderer", () => ({ openTelemostCreateInBrowser: mocks.openBrowser }));
import { createTelemostMeetingWeb } from "./meetingActions";

beforeEach(() => vi.clearAllMocks());
describe("createTelemostMeetingWeb", () => {
  it("uses the existing Windows CEF create route", async () => { expect(await createTelemostMeetingWeb("windows")).toBe("cef"); expect(mocks.cefNavigate).toHaveBeenCalledWith("https://telemost.yandex.ru/?browser-auto-create=1"); });
  it("uses the account-scoped macOS create WKWebView", async () => { expect(await createTelemostMeetingWeb("macos", "account-1")).toBe("wkwebview"); expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_create", { accountKey: "account-1" }); expect(mocks.openBrowser).not.toHaveBeenCalled(); });
  it("uses browser only for other platforms", async () => { expect(await createTelemostMeetingWeb("other")).toBe("browser"); expect(mocks.openBrowser).toHaveBeenCalled(); });
});
