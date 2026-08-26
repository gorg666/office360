import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { SendFeedbackToast } from "./SendFeedbackToast";
import { useSendStatusStore } from "@/stores/sendStatusStore";
import { showSendFeedback } from "@/utils/sendFeedbackToast";

vi.mock("@/services/composer/composeSendOrchestrator", () => ({
  cancelQueuedComposeSend: vi.fn(),
}));

describe("SendFeedbackToast MAIL-020", () => {
  beforeEach(() => {
    useSendStatusStore.getState().clear();
  });

  afterEach(() => {
    useSendStatusStore.getState().clear();
  });

  it("renders a single global toast for queued undo + ignores duplicate event", async () => {
    useSendStatusStore.getState().setActive({
      requestId: "r1",
      accountId: "a1",
      rawBase64Url: "x",
      restore: {
        mode: "new",
        to: [],
        cc: [],
        bcc: [],
        subject: "",
        bodyHtml: "",
        threadId: null,
        inReplyToMessageId: null,
        draftId: null,
        fromEmail: null,
      },
      recipientEmails: [],
      undoDelayMs: 5000,
      outboxOpId: null,
      phase: "queued",
      errorMessage: null,
    });
    useSendStatusStore.getState().setUndoVisible(true);

    render(<SendFeedbackToast />);

    expect(screen.getAllByTestId("send-feedback-toast")).toHaveLength(1);
    expect(screen.getByText("Отправка письма…")).toBeTruthy();
    expect(screen.getByText("Отменить")).toBeTruthy();

    await act(async () => {
      showSendFeedback({ title: "Отправка письма…", tone: "info" });
    });

    // Still exactly one toast instance / one title node (event suppressed while active).
    expect(screen.getAllByTestId("send-feedback-toast")).toHaveLength(1);
    expect(screen.getAllByText("Отправка письма…")).toHaveLength(1);
  });

  it("phase sending updates same toast without CustomEvent", () => {
    useSendStatusStore.getState().setActive({
      requestId: "r2",
      accountId: "a1",
      rawBase64Url: "x",
      restore: {
        mode: "new",
        to: [],
        cc: [],
        bcc: [],
        subject: "",
        bodyHtml: "",
        threadId: null,
        inReplyToMessageId: null,
        draftId: null,
        fromEmail: null,
      },
      recipientEmails: [],
      undoDelayMs: 5000,
      outboxOpId: null,
      phase: "sending",
      errorMessage: null,
    });
    useSendStatusStore.getState().setUndoVisible(false);

    render(<SendFeedbackToast />);
    expect(screen.getByTestId("send-feedback-toast")).toHaveAttribute(
      "data-send-toast",
      "global",
    );
    expect(screen.getByText("Отправка письма…")).toBeTruthy();
    expect(screen.queryByText("Отменить")).toBeNull();
  });
});
