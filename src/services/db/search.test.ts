import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./connection", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./connection";
import { searchMessages } from "./search";
import { createMockDb } from "@/test/mocks";

const mockDb = createMockDb();

describe("searchMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(
      mockDb as unknown as Awaited<ReturnType<typeof getDb>>,
    );
  });

  it("routes labelid-only searches through structured SQL", async () => {
    await searchMessages("labelid:Label_123", "acc-1", 25);

    const [sql, params] = mockDb.select.mock.calls[0]!;
    expect(sql).toContain("tl.label_id =");
    expect(sql).not.toContain("messages_fts MATCH");
    expect(params).toContain("Label_123");
    expect(params).toContain("acc-1");
    expect(params).toContain(25);
  });

  it("routes folderpath-only searches through structured SQL", async () => {
    await searchMessages('folderpath:"Work/Projects"', "acc-1");

    const [sql, params] = mockDb.select.mock.calls[0]!;
    expect(sql).toContain("m.imap_folder =");
    expect(sql).not.toContain("messages_fts MATCH");
    expect(params).toContain("Work/Projects");
  });

  it("keeps unsupported operator-like tokens in FTS search", async () => {
    await searchMessages("priority:high", "acc-1");

    const [sql, params] = mockDb.select.mock.calls[0]!;
    expect(sql).toContain("messages_fts MATCH");
    expect(params).toContain("priority:high");
  });
});
