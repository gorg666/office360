import { describe, it, expect, vi, beforeEach } from "vitest";
import { notifySendEmailOutcome, resolveSendEmailOutcome } from "./handleSendEmailResult";
import { showSendFeedback } from "./sendFeedbackToast";

vi.mock("./sendFeedbackToast", () => ({
  showSendFeedback: vi.fn(),
}));

describe("resolveSendEmailOutcome", () => {
  it("returns queued when result.queued is true", () => {
    expect(resolveSendEmailOutcome({ success: true, queued: true })).toBe("queued");
  });

  it("returns success when success without queued", () => {
    expect(resolveSendEmailOutcome({ success: true })).toBe("success");
  });

  it("returns failed when success is false", () => {
    expect(resolveSendEmailOutcome({ success: false, error: "SMTP error" })).toBe("failed");
  });
});

describe("notifySendEmailOutcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows outbox toast for queued sends", () => {
    const outcome = notifySendEmailOutcome({ success: true, queued: true });
    expect(outcome).toBe("queued");
    expect(showSendFeedback).toHaveBeenCalledWith({
      title: "Queued in Outbox",
      detail: "Message queued for sending. Check Outbox.",
      tone: "info",
    });
  });

  it("shows error toast with footnote for failed sends", () => {
    const outcome = notifySendEmailOutcome({
      success: false,
      error: "Invalid recipient",
    });
    expect(outcome).toBe("failed");
    expect(showSendFeedback).toHaveBeenCalledWith({
      title: "Send failed",
      detail: "Invalid recipient",
      footnote: "The draft was kept so you can try again.",
      tone: "error",
    });
  });

  it("is silent on success", () => {
    const outcome = notifySendEmailOutcome({ success: true });
    expect(outcome).toBe("success");
    expect(showSendFeedback).not.toHaveBeenCalled();
  });
});
