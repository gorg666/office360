import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueueInspector } from "./QueueInspector";
import {
  cancelOperation,
  listQueueInspectorOperations,
  retryOperation,
} from "@/services/db/pendingOperations";

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: (selector: (state: unknown) => unknown) => selector({
    accounts: [{ id: "acct-1", email: "user@example.com" }],
    activeAccountId: "acct-1",
  }),
}));

vi.mock("@/services/db/pendingOperations", () => ({
  listQueueInspectorOperations: vi.fn(),
  getQueueSummary: vi.fn(() => Promise.resolve({
    pending: 1,
    executing: 0,
    retryScheduled: 0,
    failed: 1,
    blocked: 0,
    cancelled: 0,
    active: 2,
    total: 2,
  })),
  retryOperation: vi.fn(() => Promise.resolve()),
  cancelOperation: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/queue/queueProcessor", () => ({
  triggerQueueFlush: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/router/navigate", () => ({
  navigateBack: vi.fn(),
}));

describe("QueueInspector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listQueueInspectorOperations).mockResolvedValue([
      {
        id: "op-1",
        accountId: "acct-1",
        operationType: "sendMessage",
        resourceId: "draft-1",
        status: "failed",
        retryCount: 1,
        maxRetries: 10,
        nextRetryAt: null,
        createdAt: 100,
        updatedAt: 120,
        lastError: "SMTP failed",
        blockedReason: null,
        diagnosticCode: "SMTP.SEND.PROVIDER_ERROR",
        userAction: "edit_settings",
        preview: {
          title: "Hello",
          subtitle: "recipient@example.com",
          fields: [{ label: "Тип", value: "Отправка письма" }],
        },
        actions: ["retry", "cancel", "edit_settings", "export_debug"],
      },
    ]);
  });

  it("renders safe queue item data and actions", async () => {
    render(<QueueInspector />);

    expect(await screen.findByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("recipient@example.com")).toBeInTheDocument();
    expect(screen.getByText("SMTP.SEND.PROVIDER_ERROR")).toBeInTheDocument();
    expect(screen.queryByText(/rawBase64Url/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();
  });

  it("retries and cancels operations from actions", async () => {
    render(<QueueInspector />);

    await screen.findByText("Hello");
    const retryButtons = screen.getAllByText("Retry");
    fireEvent.click(retryButtons[retryButtons.length - 1]!);
    await waitFor(() => expect(retryOperation).toHaveBeenCalledWith("op-1"));

    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(cancelOperation).toHaveBeenCalledWith("op-1"));
  });
});
