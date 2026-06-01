import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildComposeWindowUrl,
  buildComposeWebviewWindowOptions,
  closeStandaloneComposeWindow,
  getComposeWindowLabel,
  isComposeStandaloneWindow,
  openComposeWindow,
  openNewCompose,
} from "./openComposeWindow";

const mockSetFocus = vi.fn();
const mockGetByLabel = vi.fn();
const mockWebviewWindowCtor = vi.fn();
const mockCloseCurrentWindow = vi.fn();
const openComposerMock = vi.fn();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static getByLabel = mockGetByLabel;
    constructor(label: string, opts: unknown) {
      mockWebviewWindowCtor(label, opts);
    }
    once = vi.fn();
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: mockCloseCurrentWindow }),
}));

vi.mock("./openThreadWindow", () => ({
  isTauriRuntime: vi.fn(),
}));

vi.mock("@/stores/composerStore", () => ({
  useComposerStore: {
    getState: () => ({
      openComposer: openComposerMock,
    }),
  },
}));

import { isTauriRuntime } from "./openThreadWindow";

describe("isComposeStandaloneWindow", () => {
  it("returns true when compose query param is present", () => {
    vi.stubGlobal("location", { search: "?compose=true&mode=new" });
    expect(isComposeStandaloneWindow()).toBe(true);
  });

  it("returns false without compose query param", () => {
    vi.stubGlobal("location", { search: "?thread=abc" });
    expect(isComposeStandaloneWindow()).toBe(false);
  });
});

describe("closeStandaloneComposeWindow", () => {
  beforeEach(() => {
    mockCloseCurrentWindow.mockClear();
  });

  it("closes current Tauri window in standalone compose mode", async () => {
    vi.stubGlobal("location", { search: "?compose=true" });

    await closeStandaloneComposeWindow();

    expect(mockCloseCurrentWindow).toHaveBeenCalledOnce();
  });

  it("does not close window in embedded compose mode", async () => {
    vi.stubGlobal("location", { search: "" });

    await closeStandaloneComposeWindow();

    expect(mockCloseCurrentWindow).not.toHaveBeenCalled();
  });
});

describe("getComposeWindowLabel", () => {
  it("uses stable label for empty new compose", () => {
    expect(getComposeWindowLabel({})).toBe("compose-new");
    expect(getComposeWindowLabel({ mode: "new" })).toBe("compose-new");
  });

  it("uses draft-specific label when draftId is set", () => {
    expect(getComposeWindowLabel({ draftId: "draft/1" })).toBe("compose-draft-draft_1");
  });

  it("uses unique label when prefill is present", () => {
    const label = getComposeWindowLabel({ to: ["a@example.com"] });
    expect(label.startsWith("compose-")).toBe(true);
    expect(label).not.toBe("compose-new");
  });
});

describe("buildComposeWindowUrl", () => {
  it("includes compose flag and mode", () => {
    const url = buildComposeWindowUrl({ mode: "new", to: ["a@b.com"], subject: "Hi" });
    expect(url).toContain("compose=true");
    expect(url).toContain("mode=new");
    expect(url).toContain("to=a%40b.com");
    expect(url).toContain("subject=Hi");
  });
});

describe("openComposeWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetByLabel.mockResolvedValue(null);
  });

  it("calls fallback when Tauri runtime is unavailable", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    const onFallback = vi.fn();

    const result = await openComposeWindow({ onFallback });

    expect(result).toBe("fallback");
    expect(onFallback).toHaveBeenCalledOnce();
    expect(mockWebviewWindowCtor).not.toHaveBeenCalled();
  });

  it("focuses existing compose-new window instead of creating duplicate", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    mockGetByLabel.mockResolvedValue({ setFocus: mockSetFocus });

    const result = await openComposeWindow({ mode: "new" });

    expect(result).toBe("focused");
    expect(mockSetFocus).toHaveBeenCalledOnce();
    expect(mockWebviewWindowCtor).not.toHaveBeenCalled();
  });

  it("creates WebviewWindow in Tauri when none exists", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    mockGetByLabel.mockResolvedValue(null);

    const result = await openComposeWindow({ mode: "new" });

    expect(result).toBe("opened");
    expect(mockWebviewWindowCtor).toHaveBeenCalledWith(
      "compose-new",
      expect.objectContaining({
        url: expect.stringContaining("compose=true"),
        title: "Новое сообщение",
        decorations: false,
        resizable: true,
        focus: true,
      }),
    );
  });

  it("buildComposeWebviewWindowOptions disables system decorations", () => {
    const opts = buildComposeWebviewWindowOptions("index.html?compose=true", "Test");
    expect(opts.decorations).toBe(false);
    expect(opts.resizable).toBe(true);
    expect(opts.focus).toBe(true);
  });
});

describe("openNewCompose", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetByLabel.mockResolvedValue(null);
  });

  it("falls back to openComposer in main window when Tauri is unavailable", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    openComposerMock.mockClear();

    const result = await openNewCompose({ to: ["x@y.com"], subject: "Test" });

    expect(result).toBe("fallback");
    expect(openComposerMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "new", to: ["x@y.com"], subject: "Test" }),
    );
  });
});
