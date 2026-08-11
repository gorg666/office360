import { describe, expect, it } from "vitest";
import { normalizeSidebarNavConfig } from "./sidebarNavConfig";

describe("normalizeSidebarNavConfig", () => {
  it("places outbox immediately after sent and preserves visibility", () => {
    const result = normalizeSidebarNavConfig([
      { id: "inbox", visible: true },
      { id: "outbox", visible: false },
      { id: "sent", visible: true },
      { id: "drafts", visible: true },
    ]);
    expect(result.map((item) => item.id)).toEqual(["inbox", "sent", "outbox", "drafts"]);
    expect(result[2]?.visible).toBe(false);
  });
});
