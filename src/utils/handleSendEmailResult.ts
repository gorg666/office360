import type { ActionResult } from "@/services/emailActions";
import { showSendFeedback } from "@/utils/sendFeedbackToast";

export type SendEmailOutcome = "success" | "queued" | "failed";

export function resolveSendEmailOutcome(result: ActionResult): SendEmailOutcome {
  if (result.queued) return "queued";
  if (result.success) return "success";
  return "failed";
}

/** Show user-facing toast for queued/failed sends. Success is silent. */
export function notifySendEmailOutcome(result: ActionResult): SendEmailOutcome {
  const outcome = resolveSendEmailOutcome(result);

  if (outcome === "queued") {
    showSendFeedback({
      title: "Queued in Outbox",
      detail: "Message queued for sending. Check Outbox.",
      tone: "info",
    });
    return outcome;
  }

  if (outcome === "failed") {
    showSendFeedback({
      title: "Send failed",
      detail:
        result.error?.trim() ||
        "Message could not be sent. Please fix the issue and try again.",
      footnote: "The draft was kept so you can try again.",
      tone: "error",
    });
    return outcome;
  }

  return outcome;
}
