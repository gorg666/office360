import { describe, expect, it } from "vitest";
import {
  isThreadContextActionEnabled,
  THREAD_CONTEXT_MENU_CORE_LABELS,
} from "./threadContextMenuActions";

describe("threadContextMenuActions", () => {
  it("disables compose actions in drafts", () => {
    const view = {
      isTrashView: false,
      isDraftsView: true,
      isSpamView: false,
      isMulti: false,
    };
    expect(isThreadContextActionEnabled("reply", view)).toBe(false);
    expect(isThreadContextActionEnabled("forward", view)).toBe(false);
    expect(isThreadContextActionEnabled("snooze", view)).toBe(false);
    expect(isThreadContextActionEnabled("archive", view)).toBe(false);
    expect(isThreadContextActionEnabled("delete", view)).toBe(true);
    expect(isThreadContextActionEnabled("open", view)).toBe(true);
  });

  it("keeps core labels for RU TranslationLayer", () => {
    expect(THREAD_CONTEXT_MENU_CORE_LABELS).toContain("Open");
    expect(THREAD_CONTEXT_MENU_CORE_LABELS).toContain("Reply All");
    expect(THREAD_CONTEXT_MENU_CORE_LABELS).toContain("Move to Folder");
    expect(THREAD_CONTEXT_MENU_CORE_LABELS).toContain("Report Spam");
  });
});
