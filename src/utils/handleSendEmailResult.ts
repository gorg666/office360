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
      title: "В очереди «Исходящие»",
      detail: "Письмо поставлено в очередь. Проверьте «Исходящие».",
      tone: "info",
    });
    return outcome;
  }

  if (outcome === "failed") {
    showSendFeedback({
      title: "Не удалось отправить",
      detail:
        result.error?.trim() ||
        "Не удалось отправить письмо. Повторите попытку.",
      footnote: "Черновик сохранён — можно повторить отправку.",
      tone: "error",
    });
    return outcome;
  }

  return outcome;
}
