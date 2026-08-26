import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: vi.fn(() => ({ isOnline: true, setPendingOpsCount: vi.fn() })),
  },
}));

vi.mock("../db/pendingOperations", () => ({
  getPendingOperations: vi.fn(() => Promise.resolve([])),
  updateOperationStatus: vi.fn(() => Promise.resolve()),
  deleteOperation: vi.fn(() => Promise.resolve()),
  incrementRetry: vi.fn(() => Promise.resolve()),
  getPendingOpsCount: vi.fn(() => Promise.resolve(0)),
  getQueueSummary: vi.fn(() => Promise.resolve({
    pending: 0,
    executing: 0,
    retryScheduled: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
    active: 0,
    total: 0,
  })),
  compactQueue: vi.fn(() => Promise.resolve(0)),
  blockOperation: vi.fn(() => Promise.resolve()),
  failOperation: vi.fn(() => Promise.resolve()),
}));

vi.mock("../emailActions", () => ({
  executeQueuedAction: vi.fn(() => Promise.resolve()),
}));

vi.mock("../calendar/invitations", () => ({
  executeCalendarQueuedAction: vi.fn(() => Promise.resolve({ status: "success", value: undefined })),
}));

vi.mock("../db/calendarItipActions", () => ({
  updateCalendarItipAction: vi.fn(() => Promise.resolve()),
}));

vi.mock("../db/calendarInvitations", () => ({
  updateInvitationQueueStatus: vi.fn(() => Promise.resolve()),
}));

vi.mock("../db/accountDiagnostics", () => ({
  upsertAccountDiagnostic: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/utils/networkErrors", () => ({
  classifyError: vi.fn(() => ({
    type: "permanent",
    isRetryable: false,
    message: "error",
  })),
}));

vi.mock("../gmail/syncManager", () => ({
  triggerSync: vi.fn(() => Promise.resolve()),
}));

vi.mock("../backgroundCheckers", () => ({
  createBackgroundChecker: vi.fn((_name: string, fn: () => Promise<void>) => ({
    start: () => fn(),
    stop: vi.fn(),
  })),
}));

import { useUIStore } from "@/stores/uiStore";
import {
  getPendingOperations,
  updateOperationStatus,
  deleteOperation,
  incrementRetry,
  compactQueue,
  blockOperation,
  failOperation,
} from "../db/pendingOperations";
import { executeQueuedAction } from "../emailActions";
import { executeCalendarQueuedAction } from "../calendar/invitations";
import { classifyError } from "@/utils/networkErrors";
import { updateCalendarItipAction } from "../db/calendarItipActions";
import { updateInvitationQueueStatus } from "../db/calendarInvitations";
import { startQueueProcessor, stopQueueProcessor, triggerQueueFlush } from "./queueProcessor";
import { createMockUIStoreState } from "@/test/mocks";

const mockSetPendingOpsCount = vi.fn();

describe("queueProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useUIStore.getState).mockReturnValue(createMockUIStoreState({
      setPendingOpsCount: mockSetPendingOpsCount,
    }) as never);
    vi.mocked(getPendingOperations).mockResolvedValue([]);
  });

  it("skips processing when offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    vi.mocked(useUIStore.getState).mockReturnValue(createMockUIStoreState({
      isOnline: false,
      setPendingOpsCount: mockSetPendingOpsCount,
    }) as never);
    await triggerQueueFlush();
    expect(getPendingOperations).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("flushes queue when navigator is online but store was stuck offline", async () => {
    const setOnline = vi.fn();
    vi.stubGlobal("navigator", { onLine: true });
    vi.mocked(useUIStore.getState).mockReturnValue(createMockUIStoreState({
      isOnline: false,
      setOnline,
      setPendingOpsCount: mockSetPendingOpsCount,
    }) as never);
    await triggerQueueFlush();
    expect(setOnline).toHaveBeenCalledWith(true);
    expect(compactQueue).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("compacts queue before processing", async () => {
    await triggerQueueFlush();
    expect(compactQueue).toHaveBeenCalled();
  });

  it("processes pending operations successfully", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      {
        id: "op-1",
        account_id: "acct-1",
        operation_type: "archive",
        resource_id: "t1",
        params: '{"threadId":"t1","messageIds":[]}',
        status: "pending",
        retry_count: 0,
        max_retries: 10,
        next_retry_at: null,
        created_at: 1000,
        error_message: null,
      },
    ]);

    await triggerQueueFlush();

    expect(updateOperationStatus).toHaveBeenCalledWith("op-1", "executing");
    expect(executeQueuedAction).toHaveBeenCalledWith("acct-1", "archive", {
      threadId: "t1",
      messageIds: [],
    });
    expect(deleteOperation).toHaveBeenCalledWith("op-1");
  });

  it("dispatches calendar RSVP operations to calendar executor", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      {
        id: "op-1",
        account_id: "acct-1",
        operation_type: "calendarRsvp",
        resource_id: "invite-1",
        params: '{"invitationId":"invite-1","rsvpStatus":"accepted"}',
        status: "pending",
        retry_count: 0,
        max_retries: 10,
        next_retry_at: null,
        created_at: 1000,
        error_message: null,
      },
    ]);

    await triggerQueueFlush();

    expect(executeCalendarQueuedAction).toHaveBeenCalledWith("acct-1", "calendarRsvp", {
      invitationId: "invite-1",
      rsvpStatus: "accepted",
    });
    expect(executeQueuedAction).not.toHaveBeenCalled();
    expect(deleteOperation).toHaveBeenCalledWith("op-1");
  });

  it("moves iTIP delivery from delivering to delivered on SMTP success", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([{
      id: "op-itip", account_id: "acct-1", operation_type: "sendMessage", resource_id: "action-1",
      params: '{"rawBase64Url":"raw","itipActionKey":"action-1","itipInvitationId":"invite-1"}',
      status: "pending", retry_count: 0, max_retries: 10, next_retry_at: null, created_at: 1000, error_message: null,
    }]);

    await triggerQueueFlush();

    expect(updateCalendarItipAction).toHaveBeenNthCalledWith(1, { actionKey: "action-1", deliveryStatus: "delivering" });
    expect(updateCalendarItipAction).toHaveBeenNthCalledWith(2, expect.objectContaining({ actionKey: "action-1", deliveryStatus: "delivered" }));
    expect(updateInvitationQueueStatus).toHaveBeenCalledWith("invite-1", "delivered");
    expect(deleteOperation).toHaveBeenCalledWith("op-itip");
  });

  it("keeps iTIP ledger retryable after a transient SMTP failure", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([{
      id: "op-itip-retry", account_id: "acct-1", operation_type: "sendMessage", resource_id: "action-1",
      params: '{"rawBase64Url":"raw","itipActionKey":"action-1"}', status: "pending",
      retry_count: 0, max_retries: 10, next_retry_at: null, created_at: 1000, error_message: null,
    }]);
    vi.mocked(executeQueuedAction).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(classifyError).mockReturnValueOnce({ type: "network", isRetryable: true, message: "offline" });

    await triggerQueueFlush();

    expect(updateCalendarItipAction).toHaveBeenLastCalledWith(expect.objectContaining({
      actionKey: "action-1", deliveryStatus: "retry_scheduled", failureCode: "network",
    }));
    expect(incrementRetry).toHaveBeenCalledWith("op-itip-retry");
    expect(deleteOperation).not.toHaveBeenCalled();
  });

  it("blocks typed unsupported calendar actions without retrying", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      {
        id: "op-unsupported", account_id: "acct-1", operation_type: "calendarRsvp",
        resource_id: "invite-1", params: '{"invitationId":"invite-1"}', status: "pending",
        retry_count: 0, max_retries: 10, next_retry_at: null, created_at: 1000, error_message: null,
      },
    ]);
    vi.mocked(executeCalendarQueuedAction).mockResolvedValueOnce({
      status: "unsupported",
      message: "Удалённая доставка ответа пока не поддерживается.",
    });

    await triggerQueueFlush();

    expect(blockOperation).toHaveBeenCalledWith(
      "op-unsupported",
      "Удалённая доставка ответа пока не поддерживается.",
      expect.objectContaining({ diagnosticCode: "calendar_write_unsupported" }),
    );
    expect(incrementRetry).not.toHaveBeenCalled();
    expect(deleteOperation).not.toHaveBeenCalled();
  });

  it("retries on retryable errors", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      {
        id: "op-1",
        account_id: "acct-1",
        operation_type: "star",
        resource_id: "t1",
        params: '{"threadId":"t1","messageIds":[],"starred":true}',
        status: "pending",
        retry_count: 0,
        max_retries: 10,
        next_retry_at: null,
        created_at: 1000,
        error_message: null,
      },
    ]);
    vi.mocked(executeQueuedAction).mockRejectedValueOnce(new Error("Failed to fetch"));
    vi.mocked(classifyError).mockReturnValueOnce({
      type: "network",
      isRetryable: true,
      message: "Failed to fetch",
    });

    await triggerQueueFlush();

    expect(updateOperationStatus).toHaveBeenCalledWith("op-1", "retry_scheduled", "Failed to fetch");
    expect(incrementRetry).toHaveBeenCalledWith("op-1");
    expect(deleteOperation).not.toHaveBeenCalled();
  });

  it("marks as failed on permanent errors", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      {
        id: "op-1",
        account_id: "acct-1",
        operation_type: "archive",
        resource_id: "t1",
        params: '{"threadId":"t1","messageIds":[]}',
        status: "pending",
        retry_count: 0,
        max_retries: 10,
        next_retry_at: null,
        created_at: 1000,
        error_message: null,
      },
    ]);
    vi.mocked(executeQueuedAction).mockRejectedValueOnce(new Error("Bad request"));
    vi.mocked(classifyError).mockReturnValueOnce({
      type: "permanent",
      isRetryable: false,
      message: "Bad request",
    });

    await triggerQueueFlush();

    expect(failOperation).toHaveBeenCalledWith("op-1", "Bad request", expect.objectContaining({
      diagnosticCode: expect.any(String),
    }));
  });

  it("blocks auth errors with re-auth diagnostics", async () => {
    vi.mocked(getPendingOperations).mockResolvedValueOnce([
      {
        id: "op-1",
        account_id: "acct-1",
        operation_type: "archive",
        resource_id: "t1",
        params: '{"threadId":"t1","messageIds":[]}',
        status: "pending",
        retry_count: 0,
        max_retries: 10,
        next_retry_at: null,
        created_at: 1000,
        error_message: null,
      },
    ]);
    vi.mocked(executeQueuedAction).mockRejectedValueOnce(new Error("401 invalid_grant refresh token expired"));
    vi.mocked(classifyError).mockReturnValueOnce({
      type: "auth",
      isRetryable: false,
      message: "401 invalid_grant refresh token expired",
    });

    await triggerQueueFlush();

    expect(blockOperation).toHaveBeenCalledWith("op-1", expect.any(String), expect.objectContaining({
      diagnosticCode: expect.any(String),
      userAction: "reauth",
    }));
  });

  it("updates pending count after processing", async () => {
    await triggerQueueFlush();
    expect(mockSetPendingOpsCount).toHaveBeenCalledWith(0);
  });

  it("start and stop work without errors", () => {
    startQueueProcessor();
    stopQueueProcessor();
  });
});
