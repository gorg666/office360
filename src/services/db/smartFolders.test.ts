import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));

vi.mock("@/services/db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/db/connection")>();
  return {
    ...actual,
    getDb: mockGetDb,
    buildDynamicUpdate: vi.fn(),
    selectFirstBy: async (query: string, params: unknown[] = []) => {
      const db = await mockGetDb();
      const rows = await db.select(query, params);
      return rows[0] ?? null;
    },
  };
});

import { getDb, buildDynamicUpdate } from "@/services/db/connection";
import {
  getSmartFolders,
  getSmartFolderById,
  insertSmartFolder,
  updateSmartFolder,
  rewriteSmartFolderReference,
  markSmartFoldersMissingReference,
  deleteSmartFolder,
  updateSmartFolderSortOrder,
} from "./smartFolders";
import { createMockDb } from "@/test/mocks";

const mockDb = createMockDb();

describe("smartFolders service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(
      mockDb as unknown as Awaited<ReturnType<typeof getDb>>,
    );
  });

  describe("getSmartFolders", () => {
    it("returns global folders when no accountId", async () => {
      await getSmartFolders();

      expect(mockDb.select).toHaveBeenCalledWith(
        expect.stringContaining("WHERE account_id IS NULL"),
      );
    });

    it("returns global + account folders when accountId provided", async () => {
      await getSmartFolders("acc-1");

      expect(mockDb.select).toHaveBeenCalledWith(
        expect.stringContaining("account_id IS NULL OR account_id = $1"),
        ["acc-1"],
      );
    });

    it("orders by sort_order", async () => {
      await getSmartFolders("acc-1");

      expect(mockDb.select).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY sort_order"),
        expect.anything(),
      );
    });
  });

  describe("getSmartFolderById", () => {
    it("returns the folder when found", async () => {
      const mockFolder = {
        id: "sf-1",
        account_id: null,
        name: "Unread",
        query: "is:unread",
        icon: "MailOpen",
        color: null,
        sort_order: 0,
        is_default: 1,
        created_at: 1234567890,
      };
      mockDb.select.mockResolvedValueOnce([mockFolder]);

      const result = await getSmartFolderById("sf-1");

      expect(result).toEqual(mockFolder);
      expect(mockDb.select).toHaveBeenCalledWith(
        "SELECT * FROM smart_folders WHERE id = $1",
        ["sf-1"],
      );
    });

    it("returns null when not found", async () => {
      mockDb.select.mockResolvedValueOnce([]);

      const result = await getSmartFolderById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("insertSmartFolder", () => {
    it("inserts with all fields", async () => {
      const id = await insertSmartFolder({
        name: "Test Folder",
        query: "is:unread",
        accountId: "acc-1",
        icon: "Star",
        color: "#ff0000",
      });

      expect(id).toBeTruthy();
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO smart_folders"),
        expect.arrayContaining(["Test Folder", "is:unread", "acc-1", "Star", "#ff0000"]),
      );
    });

    it("inserts with defaults for optional fields", async () => {
      await insertSmartFolder({
        name: "Test",
        query: "from:boss",
      });

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO smart_folders"),
        expect.arrayContaining(["Test", "from:boss", null, "Search", null]),
      );
    });
  });

  describe("updateSmartFolder", () => {
    it("delegates to buildDynamicUpdate", async () => {
      vi.mocked(buildDynamicUpdate).mockReturnValue({
        sql: "UPDATE smart_folders SET name = $1 WHERE id = $2",
        params: ["New Name", "sf-1"],
      });

      await updateSmartFolder("sf-1", { name: "New Name" });

      expect(buildDynamicUpdate).toHaveBeenCalledWith(
        "smart_folders",
        "id",
        "sf-1",
        [["name", "New Name"]],
      );
      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE smart_folders SET name = $1 WHERE id = $2",
        ["New Name", "sf-1"],
      );
    });

    it("does nothing when no updates provided", async () => {
      vi.mocked(buildDynamicUpdate).mockReturnValue(null);

      await updateSmartFolder("sf-1", {});

      expect(mockDb.execute).not.toHaveBeenCalled();
    });
  });

  describe("deleteSmartFolder", () => {
    it("deletes by id", async () => {
      await deleteSmartFolder("sf-1");

      expect(mockDb.execute).toHaveBeenCalledWith(
        "DELETE FROM smart_folders WHERE id = $1",
        ["sf-1"],
      );
    });
  });

  describe("reference maintenance", () => {
    it("marks labelid smart folders as missing_reference", async () => {
      mockDb.select.mockResolvedValueOnce([
        {
          id: "sf-label",
          account_id: "acc-1",
          name: "Deleted label",
          query: "labelid:Label_123 is:unread",
          icon: "Tag",
          color: null,
          sort_order: 0,
          is_default: 0,
          created_at: 1234567890,
        },
      ]);
      vi.mocked(buildDynamicUpdate).mockReturnValue({
        sql: "UPDATE smart_folders SET status = $1 WHERE id = $2",
        params: ["missing_reference", "sf-label"],
      });

      await markSmartFoldersMissingReference(
        "acc-1",
        "labelid",
        "Label_123",
        "Label Work was deleted.",
      );

      expect(buildDynamicUpdate).toHaveBeenCalledWith(
        "smart_folders",
        "id",
        "sf-label",
        [
          ["status", "missing_reference"],
          ["status_reason", "Label Work was deleted."],
          ["status_updated_at", expect.any(Number)],
        ],
      );
      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE smart_folders SET status = $1 WHERE id = $2",
        ["missing_reference", "sf-label"],
      );
    });

    it("rewrites quoted folderpath references and clears missing_reference status", async () => {
      mockDb.select.mockResolvedValueOnce([
        {
          id: "sf-folder",
          account_id: "acc-1",
          name: "Project folder",
          query: 'folderpath:"Work/Old" has:attachment',
          icon: "Folder",
          color: null,
          sort_order: 0,
          is_default: 0,
          created_at: 1234567890,
          status: "missing_reference",
          status_reason: "Folder Work/Old was deleted.",
        },
      ]);
      vi.mocked(buildDynamicUpdate).mockReturnValue({
        sql: "UPDATE smart_folders SET query = $1 WHERE id = $2",
        params: ['folderpath:"Work/New" has:attachment', "sf-folder"],
      });

      await rewriteSmartFolderReference(
        "acc-1",
        "folderpath",
        "Work/Old",
        "Work/New",
      );

      expect(buildDynamicUpdate).toHaveBeenCalledWith(
        "smart_folders",
        "id",
        "sf-folder",
        [
          ["query", 'folderpath:"Work/New" has:attachment'],
          ["status", "ok"],
          ["status_reason", null],
          ["status_updated_at", expect.any(Number)],
        ],
      );
      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE smart_folders SET query = $1 WHERE id = $2",
        ['folderpath:"Work/New" has:attachment', "sf-folder"],
      );
    });
  });

  describe("updateSmartFolderSortOrder", () => {
    it("updates sort_order for each item", async () => {
      await updateSmartFolderSortOrder([
        { id: "sf-1", sortOrder: 2 },
        { id: "sf-2", sortOrder: 0 },
      ]);

      expect(mockDb.execute).toHaveBeenCalledTimes(2);
      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE smart_folders SET sort_order = $1 WHERE id = $2",
        [2, "sf-1"],
      );
      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE smart_folders SET sort_order = $1 WHERE id = $2",
        [0, "sf-2"],
      );
    });
  });
});
