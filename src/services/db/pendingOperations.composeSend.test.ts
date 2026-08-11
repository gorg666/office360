import { describe, it, expect, vi, beforeEach } from "vitest";

const dbSelect = vi.fn();
const dbExecute = vi.fn();

vi.mock("./connection", () => ({
  getDb: async () => ({ select: dbSelect, execute: dbExecute }),
}));

import { enqueueQueuedComposeSend } from "./pendingOperations";

describe("enqueueQueuedComposeSend idempotency", () => {
  beforeEach(() => {
    dbSelect.mockReset();
    dbExecute.mockReset();
  });

  it("returns existing id for same requestId", async () => {
    dbSelect.mockResolvedValue([
      {
        id: "req-1",
        account_id: "acc",
        operation_type: "sendMessage",
        resource_id: "req-1",
        params: "{}",
        status: "queued",
      },
    ]);

    const id = await enqueueQueuedComposeSend("acc", "req-1", { rawBase64Url: "x" });
    expect(id).toBe("req-1");
    expect(dbExecute).not.toHaveBeenCalled();
  });

  it("inserts once when no existing row", async () => {
    dbSelect.mockResolvedValue([]);
    dbExecute.mockResolvedValue(undefined);

    const id = await enqueueQueuedComposeSend("acc", "req-2", { rawBase64Url: "x" });
    expect(id).toBe("req-2");
    expect(dbExecute).toHaveBeenCalledTimes(1);
    expect(dbExecute.mock.calls[0]![1][0]).toBe("req-2");
  });
});
