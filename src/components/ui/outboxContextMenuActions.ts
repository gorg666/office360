/**
 * Capability map for Outbox context menu.
 * Only expose actions the client can safely execute against pending_operations.
 */

export type OutboxContextPhase =
  | "queued"
  | "sending"
  | "failed"
  | "sent_reconciling";

export type OutboxContextActionId =
  | "open"
  | "cancel-send"
  | "open-status"
  | "open-draft"
  | "retry"
  | "delete";

export function mapOutboxContextPhase(status: string): OutboxContextPhase {
  if (status === "failed") return "failed";
  if (status === "executing" || status === "sending") return "sending";
  if (status === "smtp_accepted" || status === "sent_reconciling") {
    return "sent_reconciling";
  }
  // queued | pending | hold-for-undo window
  return "queued";
}

/** Safe cancel only before SMTP handoff (queued/pending). Not during executing. */
export function canSafelyCancelOutboxSend(phase: OutboxContextPhase): boolean {
  return phase === "queued";
}

export function isOutboxContextActionEnabled(
  id: OutboxContextActionId,
  phase: OutboxContextPhase,
): boolean {
  switch (phase) {
    case "queued":
      return id === "open" || id === "cancel-send";
    case "sending":
      return id === "open-status";
    case "failed":
      return id === "open-draft" || id === "retry" || id === "delete";
    case "sent_reconciling":
      return id === "open-status";
    default:
      return false;
  }
}

export const OUTBOX_CONTEXT_MENU_LABELS = {
  open: "Open",
  cancelSend: "Cancel send",
  openStatus: "Open status",
  openDraft: "Open draft",
  retry: "Retry",
  delete: "Delete from Outbox",
} as const;
