import { describe, expect, it } from "vitest";
import { getThreadWindowLabel } from "./openThreadWindow";

describe("getThreadWindowLabel", () => {
  it("sanitizes thread id for Tauri window label", () => {
    expect(getThreadWindowLabel("abc-123")).toBe("thread-abc-123");
    expect(getThreadWindowLabel("a/b+c")).toBe("thread-a_b_c");
  });

  it("returns stable label for the same thread", () => {
    const id = "thread-with-dashes";
    expect(getThreadWindowLabel(id)).toBe(getThreadWindowLabel(id));
  });
});
