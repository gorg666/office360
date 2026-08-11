import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const scheduleMocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  notifySendEmailOutcome: vi.fn(),
  showSendFeedback: vi.fn(),
  upsertContact: vi.fn(),
  enqueueQueuedComposeSend: vi.fn(),
  deleteOperation: vi.fn(),
  updateOperationStatus: vi.fn(),
  openComposeWindow: vi.fn(),
  startAutoSave: vi.fn(),
  archiveThread: vi.fn(),
  deleteDraft: vi.fn(),
}));

vi.mock("@/services/emailActions", () => ({
  sendEmail: scheduleMocks.sendEmail,
  archiveThread: scheduleMocks.archiveThread,
  deleteDraft: scheduleMocks.deleteDraft,
}));

vi.mock("@/utils/handleSendEmailResult", () => ({
  notifySendEmailOutcome: scheduleMocks.notifySendEmailOutcome,
}));

vi.mock("@/utils/sendFeedbackToast", () => ({
  showSendFeedback: scheduleMocks.showSendFeedback,
}));

vi.mock("@/services/db/contacts", () => ({
  upsertContact: scheduleMocks.upsertContact,
}));

vi.mock("@/services/db/pendingOperations", () => ({
  enqueueQueuedComposeSend: scheduleMocks.enqueueQueuedComposeSend,
  deleteOperation: scheduleMocks.deleteOperation,
  updateOperationStatus: scheduleMocks.updateOperationStatus,
}));

vi.mock("@/utils/openComposeWindow", () => ({
  openComposeWindow: scheduleMocks.openComposeWindow,
}));

vi.mock("@/services/composer/draftAutoSave", () => ({
  startAutoSave: scheduleMocks.startAutoSave,
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({ sendAndArchive: false }),
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@/utils/openThreadWindow", () => ({
  isTauriRuntime: () => false,
}));

import {
  scheduleComposeSend,
  cancelQueuedComposeSend,
  __resetComposeSendDedupeForTests,
} from "./composeSendOrchestrator";
import { useSendStatusStore } from "@/stores/sendStatusStore";

const restore = {
  mode: "new" as const,
  to: ["a@example.com"],
  cc: [] as string[],
  bcc: [] as string[],
  subject: "Hi",
  bodyHtml: "<p>Hi</p>",
  threadId: null,
  inReplyToMessageId: null,
  draftId: null,
  fromEmail: null,
};

describe("composeSendOrchestrator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetComposeSendDedupeForTests();
    useSendStatusStore.getState().clear();
    scheduleMocks.enqueueQueuedComposeSend.mockImplementation(
      async (_accountId: string, requestId: string) => requestId,
    );
    scheduleMocks.notifySendEmailOutcome.mockReturnValue("success");
    scheduleMocks.sendEmail.mockResolvedValue({
      success: true,
      data: {
        id: "imap-sent-1",
        smtpAccepted: true,
        appendedToSent: true,
        localPersisted: true,
      },
    });
    scheduleMocks.openComposeWindow.mockResolvedValue("opened");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    __resetComposeSendDedupeForTests();
  });

  it("queues then sends after undo delay", async () => {
    await scheduleComposeSend({
      requestId: "req-1",
      accountId: "acc-1",
      rawBase64Url: "raw",
      restore,
      recipientEmails: ["a@example.com"],
      undoDelayMs: 1000,
    });

    expect(useSendStatusStore.getState().undoVisible).toBe(true);
    expect(useSendStatusStore.getState().active?.phase).toBe("queued");
    expect(scheduleMocks.sendEmail).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(scheduleMocks.sendEmail).toHaveBeenCalledWith("acc-1", "raw", undefined);
    expect(scheduleMocks.deleteOperation).toHaveBeenCalledWith("req-1");
    expect(scheduleMocks.showSendFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Письмо отправлено" }),
    );
    expect(useSendStatusStore.getState().active).toBeNull();
  });

  it("one requestId schedules only once (duplicate event)", async () => {
    const payload = {
      requestId: "req-dup",
      accountId: "acc-1",
      rawBase64Url: "raw",
      restore,
      recipientEmails: ["a@example.com"],
      undoDelayMs: 5000,
    };

    await scheduleComposeSend(payload);
    await scheduleComposeSend(payload);

    expect(scheduleMocks.enqueueQueuedComposeSend).toHaveBeenCalledTimes(1);
  });

  it("cancel restores compose and deletes outbox op", async () => {
    await scheduleComposeSend({
      requestId: "req-2",
      accountId: "acc-1",
      rawBase64Url: "raw",
      restore,
      recipientEmails: ["a@example.com"],
      undoDelayMs: 5000,
    });

    await cancelQueuedComposeSend();

    expect(scheduleMocks.deleteOperation).toHaveBeenCalledWith("req-2");
    expect(scheduleMocks.openComposeWindow).toHaveBeenCalled();
    expect(scheduleMocks.sendEmail).not.toHaveBeenCalled();
    expect(useSendStatusStore.getState().active).toBeNull();
  });

  it("failed send restores draft", async () => {
    scheduleMocks.notifySendEmailOutcome.mockReturnValue("failed");
    scheduleMocks.sendEmail.mockResolvedValue({
      success: false,
      error: "SMTP fail",
    });

    await scheduleComposeSend({
      requestId: "req-3",
      accountId: "acc-1",
      rawBase64Url: "raw",
      restore,
      recipientEmails: ["a@example.com"],
      undoDelayMs: 0,
    });

    expect(scheduleMocks.openComposeWindow).toHaveBeenCalled();
    expect(scheduleMocks.updateOperationStatus).toHaveBeenCalledWith(
      "req-3",
      "failed",
      "SMTP fail",
    );
  });

  it("SMTP success without local Sent — no final success toast", async () => {
    scheduleMocks.sendEmail.mockResolvedValue({
      success: true,
      data: {
        id: "imap-sent-x",
        smtpAccepted: true,
        appendedToSent: false,
        localPersisted: false,
      },
    });

    await scheduleComposeSend({
      requestId: "req-4",
      accountId: "acc-1",
      rawBase64Url: "raw",
      restore,
      recipientEmails: ["a@example.com"],
      undoDelayMs: 0,
    });

    expect(scheduleMocks.deleteOperation).not.toHaveBeenCalled();
    expect(scheduleMocks.showSendFeedback).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Письмо отправлено" }),
    );
    expect(scheduleMocks.showSendFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Письмо принято сервером",
        tone: "error",
      }),
    );
  });

  it("pending removed only after local Sent durable", async () => {
    await scheduleComposeSend({
      requestId: "req-5",
      accountId: "acc-1",
      rawBase64Url: "raw",
      restore,
      recipientEmails: ["a@example.com"],
      undoDelayMs: 0,
    });

    const deleteOrder = scheduleMocks.deleteOperation.mock.invocationCallOrder[0];
    const feedbackCalls = scheduleMocks.showSendFeedback.mock.calls.map((c) => c[0].title);
    expect(feedbackCalls).toContain("Письмо отправлено. Обновляем «Отправленные»…");
    expect(feedbackCalls[feedbackCalls.length - 1]).toBe("Письмо отправлено");
    expect(deleteOrder).toBeDefined();
  });
});
