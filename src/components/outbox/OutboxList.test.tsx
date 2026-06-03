import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OutboxList } from "./OutboxList";
import {
  cancelOutboxOperation,
  getOutboxSendOperations,
  retryOutboxOperation,
} from "@/services/db/pendingOperations";

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: (selector: (state: unknown) => unknown) => selector({
    activeAccountId: "acct-1",
  }),
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: (selector: (state: unknown) => unknown) => selector({
    pendingOpsCount: 1,
  }),
}));

vi.mock("@/services/db/pendingOperations", () => ({
  getOutboxSendOperations: vi.fn(),
  retryOutboxOperation: vi.fn(() => Promise.resolve()),
  cancelOutboxOperation: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/queue/queueProcessor", () => ({
  triggerQueueFlush: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/components/ui/EmptyState", () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("@/components/ui/illustrations", () => ({
  GenericEmptyIllustration: () => null,
}));

describe("OutboxList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOutboxSendOperations).mockResolvedValue([
      {
        id: "op-1",
        account_id: "acct-1",
        operation_type: "sendMessage",
        resource_id: "draft-1",
        params: JSON.stringify({ subject: "Failed send", to: "recipient@example.com" }),
        status: "failed",
        retry_count: 1,
        max_retries: 10,
        next_retry_at: null,
        created_at: 100,
        error_message: "SMTP failed",
      },
    ]);
  });

  it("shows retry and cancel actions for failed sends", async () => {
    render(<OutboxList />);

    expect(await screen.findByText("Failed send")).toBeInTheDocument();
    expect(screen.getByText("SMTP failed")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Повторить"));
    await waitFor(() => expect(retryOutboxOperation).toHaveBeenCalledWith("op-1"));

    fireEvent.click(screen.getByText("Отменить"));
    await waitFor(() => expect(cancelOutboxOperation).toHaveBeenCalledWith("op-1"));
  });
});
