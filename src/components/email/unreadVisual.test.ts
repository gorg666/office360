import { describe, expect, it } from "vitest";

/** Pure helpers mirroring ThreadCard unread presentation rules. */
function unreadClasses(isRead: boolean): {
  rowBg: string;
  sender: string;
  subject: string;
  showDot: boolean;
} {
  return {
    rowBg: isRead ? "hover:bg-bg-hover" : "bg-accent/[0.04] hover:bg-bg-hover",
    sender: isRead
      ? "font-normal text-text-secondary"
      : "font-semibold text-text-primary",
    subject: isRead
      ? "font-normal text-text-secondary"
      : "font-semibold text-text-primary",
    showDot: !isRead,
  };
}

describe("unread visual model", () => {
  it("marks unread with bold + light bg + indicator", () => {
    const u = unreadClasses(false);
    expect(u.showDot).toBe(true);
    expect(u.sender).toContain("font-semibold");
    expect(u.subject).toContain("font-semibold");
    expect(u.rowBg).toContain("bg-accent/");
  });

  it("marks read as normal weight without indicator", () => {
    const r = unreadClasses(true);
    expect(r.showDot).toBe(false);
    expect(r.sender).toContain("font-normal");
    expect(r.subject).toContain("font-normal");
  });
});
