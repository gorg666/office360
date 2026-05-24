export type SendFeedbackTone = "info" | "error";

export interface SendFeedbackPayload {
  title: string;
  detail?: string;
  footnote?: string;
  tone: SendFeedbackTone;
}

export const SEND_FEEDBACK_EVENT = "velo-send-feedback";

export function showSendFeedback(payload: SendFeedbackPayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SEND_FEEDBACK_EVENT, { detail: payload }));
}
