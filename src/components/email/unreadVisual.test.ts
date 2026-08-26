import { describe, expect, it } from "vitest";
import { densityPadding, threadRowVisual, type ThreadRowState } from "./threadRowVisual";

/**
 * These assert the module ThreadCard actually imports. The previous version of
 * this file re-declared the rules locally, so it could pass while the component
 * said something else.
 */
const state = (over: Partial<ThreadRowState> = {}): ThreadRowState => ({
  isRead: true,
  isSelected: false,
  isMultiSelected: false,
  isDragging: false,
  isSpam: false,
  ...over,
});

describe("thread row visual model", () => {
  it("marks unread with a visible tint, bold text and an indicator", () => {
    const v = threadRowVisual(state({ isRead: false }));
    expect(v.showDot).toBe(true);
    expect(v.sender).toContain("font-semibold");
    expect(v.subject).toContain("font-semibold");
    expect(v.row).toContain("bg-brand-tint-1");
  });

  it("marks read as normal weight without an indicator", () => {
    const v = threadRowVisual(state());
    expect(v.showDot).toBe(false);
    expect(v.sender).toContain("font-normal");
    expect(v.subject).toContain("font-normal");
  });

  it("gives the selected row a brand tint and a left marker", () => {
    const v = threadRowVisual(state({ isSelected: true }));
    expect(v.row).toContain("bg-brand-tint-2");
    expect(v.row).toContain("before:w-[3px]");
    expect(v.row).toContain("before:bg-brand");
  });

  it("keeps a selected read row legible by emphasising its text", () => {
    const v = threadRowVisual(state({ isRead: true, isSelected: true }));
    expect(v.sender).toContain("text-ink-primary");
  });

  it("hover on a read row changes background only — no lift, no shadow", () => {
    const v = threadRowVisual(state());
    expect(v.row).toContain("hover:bg-surface-sunken");
    expect(v.row).not.toMatch(/translate|shadow|scale/);
  });

  it("never applies a lift in any state", () => {
    const flags = [true, false];
    for (const isRead of flags) {
      for (const isSelected of flags) {
        for (const isMultiSelected of flags) {
          for (const isSpam of flags) {
            const v = threadRowVisual(
              state({ isRead, isSelected, isMultiSelected, isSpam }),
            );
            expect(v.row).not.toMatch(/translate|shadow|scale/);
          }
        }
      }
    }
  });

  it("ranks dragging above selection and selection above unread", () => {
    expect(
      threadRowVisual(state({ isDragging: true, isSelected: true, isRead: false })).row,
    ).toContain("opacity-50");

    const selectedUnread = threadRowVisual(state({ isSelected: true, isRead: false }));
    expect(selectedUnread.row).toContain("bg-brand-tint-2");
    expect(selectedUnread.row).not.toContain("bg-brand-tint-1 ");
  });

  it("layers spam over the base state instead of replacing it", () => {
    const v = threadRowVisual(state({ isSpam: true, isRead: false }));
    expect(v.row).toContain("bg-danger-surface");
    expect(v.showDot).toBe(true);
  });

  it("does not tint a dragging row as spam", () => {
    const v = threadRowVisual(state({ isSpam: true, isDragging: true }));
    expect(v.row).not.toContain("bg-danger-surface");
  });

  describe("densityPadding", () => {
    it("returns a distinct padding per density, tightest for compact", () => {
      const compact = densityPadding("compact");
      const normal = densityPadding("default");
      const spacious = densityPadding("spacious");
      expect(new Set([compact, normal, spacious]).size).toBe(3);
      expect(compact).toBe("px-3 py-1.5");
    });
  });
});
