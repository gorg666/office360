import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/db/connection", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/services/db/pendingOperations", () => ({
  deleteOperation: vi.fn(),
  updateOperationStatus: vi.fn(),
}));

import { getDb } from "@/services/db/connection";
import { deleteOperation, updateOperationStatus } from "@/services/db/pendingOperations";
import {
  classifyOutboxOperation,
  reconcileOutboxPendingOperations,
} from "./reconcileOutboxPending";
import type { PendingOperation } from "@/services/db/pendingOperations";

function op(partial: Partial<PendingOperation> & Pick<PendingOperation, "id" | "status" | "params">): PendingOperation {
  return {
    account_id: "acct-1",
    operation_type: "sendMessage",
    resource_id: partial.id,
    retry_count: 0,
    max_retries: 5,
    next_retry_at: null,
    created_at: Date.now(),
    error_message: null,
    ...partial,
  };
}

describe("reconcileOutboxPending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cleans op when durable SENT exists", async () => {
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn().mockResolvedValue([{ id: "msg-1" }]),
    } as never);

    const result = await classifyOutboxOperation(
      op({
        id: "req-1",
        status: "queued",
        params: JSON.stringify({
          rawBase64Url: "abc",
          restore: { subject: "aaaaa" },
        }),
      }),
    );
    expect(result.action).toBe("cleaned_sent");
  });

  it("does not delete queued solely by age when no SENT", async () => {
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn().mockResolvedValue([]),
    } as never);

    const result = await classifyOutboxOperation(
      op({
        id: "req-old",
        status: "queued",
        created_at: Date.now() - 86400_000 * 30,
        params: JSON.stringify({
          rawBase64Url: "abc",
          holdForUndo: true,
          restore: { subject: "aaaaa" },
        }),
      }),
    );
    expect(result.action).toBe("normalized_pending");
  });

  it("marks stale executing without SENT as failed", async () => {
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn().mockResolvedValue([]),
    } as never);

    const result = await classifyOutboxOperation(
      op({
        id: "req-exec",
        status: "executing",
        params: JSON.stringify({ rawBase64Url: "abc", subject: "x" }),
      }),
    );
    expect(result.action).toBe("marked_failed");
  });

  it("marks orphan queued without payload as failed", async () => {
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn().mockResolvedValue([]),
    } as never);

    const result = await classifyOutboxOperation(
      op({
        id: "req-orphan",
        status: "queued",
        params: JSON.stringify({ restore: { subject: "aaaaa" } }),
      }),
    );
    expect(result.action).toBe("marked_failed");
  });

  it("applies reconciliation actions", async () => {
    const select = vi
      .fn()
      .mockResolvedValueOnce([
        op({
          id: "a",
          status: "queued",
          params: JSON.stringify({
            rawBase64Url: "x",
            restore: { subject: "gone" },
          }),
        }),
        op({
          id: "b",
          status: "executing",
          params: JSON.stringify({ rawBase64Url: "y" }),
        }),
      ])
      // findDurableSent for a
      .mockResolvedValueOnce([])
      // findDurableSent for b
      .mockResolvedValueOnce([]);

    vi.mocked(getDb).mockResolvedValue({ select } as never);

    const results = await reconcileOutboxPendingOperations();
    expect(results.map((r) => r.action)).toEqual([
      "normalized_pending",
      "marked_failed",
    ]);
    expect(updateOperationStatus).toHaveBeenCalledWith("a", "pending");
    expect(updateOperationStatus).toHaveBeenCalledWith(
      "b",
      "failed",
      "Не отправлено",
    );
    expect(deleteOperation).not.toHaveBeenCalled();
  });
});
