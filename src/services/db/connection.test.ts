import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Database before importing module under test
const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockDb = { execute: mockExecute, select: mockSelect };

function withoutPragmas(log: string[]): string[] {
  return log.filter((sql) => !sql.startsWith("PRAGMA "));
}

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: vi.fn(() => Promise.resolve(mockDb)),
  },
}));

// Use dynamic import so mocks are in place
const { withTransaction, getDb, executeWrite } = await import("./connection");

describe("withTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
  });

  it("executes callback without pooled BEGIN/COMMIT", async () => {
    const callOrder: string[] = [];
    mockExecute.mockImplementation(async (sql: string) => {
      callOrder.push(sql);
    });

    await withTransaction(async () => {
      callOrder.push("callback");
    });

    expect(withoutPragmas(callOrder)).toEqual(["callback"]);
  });

  it("propagates callback errors without opening a pooled transaction", async () => {
    const callOrder: string[] = [];
    mockExecute.mockImplementation(async (sql: string) => {
      callOrder.push(sql);
    });

    await expect(
      withTransaction(async () => {
        throw new Error("callback failed");
      }),
    ).rejects.toThrow("callback failed");

    expect(withoutPragmas(callOrder)).toEqual([]);
  });

  it("serialises concurrent transactions via mutex", async () => {
    const executionLog: string[] = [];

    mockExecute.mockImplementation(async (sql: string) => {
      executionLog.push(sql);
    });

    // Launch two transactions concurrently
    const tx1 = withTransaction(async () => {
      executionLog.push("tx1-work");
      // Simulate async work
      await new Promise((r) => setTimeout(r, 10));
      executionLog.push("tx1-done");
    });

    const tx2 = withTransaction(async () => {
      executionLog.push("tx2-work");
    });

    await Promise.all([tx1, tx2]);

    expect(executionLog).toEqual(["tx1-work", "tx1-done", "tx2-work"]);
  });

  it("unblocks next transaction even if current one fails", async () => {
    // First transaction fails
    const tx1 = withTransaction(async () => {
      throw new Error("tx1 failed");
    }).catch(() => {
      /* expected */
    });

    // Second transaction should still run
    let tx2Ran = false;
    const tx2 = withTransaction(async () => {
      tx2Ran = true;
    });

    await Promise.all([tx1, tx2]);

    expect(tx2Ran).toBe(true);
  });
});

describe("executeWrite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
  });

  it("retries object-shaped SQLITE_BUSY errors", async () => {
    mockExecute
      .mockRejectedValueOnce({ code: 5, message: "database is locked" })
      .mockResolvedValueOnce(undefined);

    await executeWrite("INSERT INTO accounts (id) VALUES ($1)", ["acc-1"]);

    expect(mockExecute).toHaveBeenCalledWith(
      "INSERT INTO accounts (id) VALUES ($1)",
      ["acc-1"],
    );
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("retries Tauri SQL code 5 error strings", async () => {
    mockExecute
      .mockRejectedValueOnce("error returned from database: (code: 5) database is locked")
      .mockResolvedValueOnce(undefined);

    await executeWrite("UPDATE accounts SET email = $1 WHERE id = $2", ["a@b.com", "acc-1"]);

    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});

describe("getDb", () => {
  it("returns the same instance on repeated calls", async () => {
    const db1 = await getDb();
    const db2 = await getDb();
    expect(db1).toBe(db2);
  });
});
