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
      title: "В очереди «Исходящие»",
      detail: "Письмо поставлено в очередь. Проверьте «Исходящие».",
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
      title: "Не удалось отправить",
      detail: "Invalid recipient",
      footnote: "Черновик сохранён — можно повторить отправку.",
      tone: "error",
    });
  });

  it("is silent on success", () => {
    const outcome = notifySendEmailOutcome({ success: true });
    expect(outcome).toBe("success");
    expect(showSendFeedback).not.toHaveBeenCalled();
  });
});
