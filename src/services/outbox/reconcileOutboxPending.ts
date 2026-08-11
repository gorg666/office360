import { getDb } from "@/services/db/connection";
import {
  deleteOperation,
  updateOperationStatus,
  type PendingOperation,
} from "@/services/db/pendingOperations";

const RECONCILE_STATUSES = [
  "queued",
  "pending",
  "executing",
  "sending",
  "failed",
  "smtp_accepted",
  "sent_reconciling",
] as const;

export type OutboxReconcileAction =
  | "kept"
  | "cleaned_sent"
  | "normalized_pending"
  | "marked_failed"
  | "skipped";

export interface OutboxReconcileResult {
  opId: string;
  action: OutboxReconcileAction;
  reason: string;
}

interface ComposeSendParams {
  rawBase64Url?: string;
  holdForUndo?: boolean;
  restore?: { subject?: string };
  subject?: string;
  requestId?: string;
  messageId?: string;
  message_id_header?: string;
}

function parseParams(raw: string): ComposeSendParams {
  try {
    return JSON.parse(raw) as ComposeSendParams;
  } catch {
    return {};
  }
}

function subjectOf(params: ComposeSendParams): string | null {
  const fromRestore = params.restore?.subject?.trim();
  if (fromRestore) return fromRestore;
  const direct = params.subject?.trim();
  return direct || null;
}

/**
 * Look for a durable local SENT copy matching Message-ID and/or subject.
 */
export async function findDurableSentRecord(
  accountId: string,
  params: ComposeSendParams,
): Promise<boolean> {
  const db = await getDb();
  const messageId =
    params.message_id_header?.trim() ||
    params.messageId?.trim() ||
    null;

  if (messageId) {
    const byHeader = await db.select<{ id: string }[]>(
      `SELECT m.id FROM messages m
       INNER JOIN thread_labels tl
         ON tl.account_id = m.account_id AND tl.thread_id = m.thread_id
       WHERE m.account_id = $1
         AND tl.label_id = 'SENT'
         AND m.message_id_header = $2
       LIMIT 1`,
      [accountId, messageId],
    );
    if (byHeader.length > 0) return true;
  }

  const subject = subjectOf(params);
  if (!subject) return false;

  const bySubject = await db.select<{ id: string }[]>(
    `SELECT m.id FROM messages m
     INNER JOIN thread_labels tl
       ON tl.account_id = m.account_id AND tl.thread_id = m.thread_id
     WHERE m.account_id = $1
       AND tl.label_id = 'SENT'
       AND m.subject = $2
     LIMIT 1`,
    [accountId, subject],
  );
  return bySubject.length > 0;
}

export async function listSendOperationsForReconcile(
  accountId?: string,
): Promise<PendingOperation[]> {
  const db = await getDb();
  const placeholders = RECONCILE_STATUSES.map((_, i) => `$${i + 1}`).join(", ");
  if (accountId) {
    return db.select<PendingOperation[]>(
      `SELECT * FROM pending_operations
       WHERE operation_type = 'sendMessage'
         AND status IN (${placeholders})
         AND account_id = $${RECONCILE_STATUSES.length + 1}
       ORDER BY created_at ASC`,
      [...RECONCILE_STATUSES, accountId],
    );
  }
  return db.select<PendingOperation[]>(
    `SELECT * FROM pending_operations
     WHERE operation_type = 'sendMessage'
       AND status IN (${placeholders})
     ORDER BY created_at ASC`,
    [...RECONCILE_STATUSES],
  );
}

/**
 * Classify one legacy/in-flight send op. Does not delete queued mail by age.
 */
export async function classifyOutboxOperation(
  op: PendingOperation,
): Promise<{ action: OutboxReconcileAction; reason: string }> {
  if (op.operation_type !== "sendMessage") {
    return { action: "skipped", reason: "not_sendMessage" };
  }

  const params = parseParams(op.params);
  const hasPayload = typeof params.rawBase64Url === "string" && params.rawBase64Url.length > 0;

  const sentExists = await findDurableSentRecord(op.account_id, params);
  if (sentExists) {
    return { action: "cleaned_sent", reason: "durable_sent_found" };
  }

  if (op.status === "failed") {
    return { action: "kept", reason: "already_failed" };
  }

  if (op.status === "pending") {
    if (!hasPayload) {
      return {
        action: "marked_failed",
        reason: "pending_without_payload",
      };
    }
    return { action: "kept", reason: "pending_ready" };
  }

  if (op.status === "queued") {
    if (!hasPayload) {
      return {
        action: "marked_failed",
        reason: "queued_orphan_no_payload",
      };
    }
    // Undo-hold or crash mid-queue: promote so queue processor can finish send.
    return { action: "normalized_pending", reason: "queued_to_pending" };
  }

  if (
    op.status === "executing" ||
    op.status === "sending" ||
    op.status === "smtp_accepted" ||
    op.status === "sent_reconciling"
  ) {
    if (hasPayload) {
      return {
        action: "marked_failed",
        reason: `stale_${op.status}_needs_retry`,
      };
    }
    return {
      action: "marked_failed",
      reason: `stale_${op.status}_orphan`,
    };
  }

  return { action: "kept", reason: `unhandled_${op.status}` };
}

const FAIL_USER_MESSAGE = "Не отправлено";

/**
 * Startup reconciliation for Outbox pending_operations.
 * Never deletes a queued message solely because it is old.
 */
export async function reconcileOutboxPendingOperations(
  accountId?: string,
): Promise<OutboxReconcileResult[]> {
  const ops = await listSendOperationsForReconcile(accountId);
  const results: OutboxReconcileResult[] = [];

  for (const op of ops) {
    const { action, reason } = await classifyOutboxOperation(op);

    if (action === "cleaned_sent") {
      await deleteOperation(op.id);
      results.push({ opId: op.id, action, reason });
      continue;
    }

    if (action === "normalized_pending") {
      await updateOperationStatus(op.id, "pending");
      results.push({ opId: op.id, action, reason });
      continue;
    }

    if (action === "marked_failed") {
      await updateOperationStatus(op.id, "failed", FAIL_USER_MESSAGE);
      results.push({ opId: op.id, action, reason });
      continue;
    }

    results.push({ opId: op.id, action, reason });
  }

  if (typeof window !== "undefined" && results.some((r) => r.action !== "kept" && r.action !== "skipped")) {
    window.dispatchEvent(new Event("velo-outbox-changed"));
  }

  return results;
}
