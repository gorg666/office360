import { describe, it, expect, vi, beforeEach } from "vitest";

const dbSelect = vi.fn();

vi.mock("./connection", () => ({
  getDb: async () => ({ select: dbSelect }),
  selectFirstBy: vi.fn(),
}));

import { getRecentContacts } from "./contacts";

describe("getRecentContacts", () => {
  beforeEach(() => {
    dbSelect.mockReset();
  });

  it("queries contacts ordered by recent use", async () => {
    dbSelect.mockResolvedValue([
      { id: "1", email: "a@x.com", display_name: "A", frequency: 3 },
    ]);
    const rows = await getRecentContacts(5);
    expect(rows).toHaveLength(1);
    expect(dbSelect).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY COALESCE(last_contacted_at, 0) DESC"),
      [5],
    );
  });
});
