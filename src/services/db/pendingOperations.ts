import { getDb } from "./connection";
import { parseOutboxSendPreview } from "@/utils/outboxSendPreview";

export const QUEUE_OPERATION_STATUSES = [
  "pending",
  "executing",
  "retry_scheduled",
  "failed",
  "blocked",
  "cancelled",
] as const;

export type QueueOperationStatus = (typeof QUEUE_OPERATION_STATUSES)[number];

export const QUEUE_USER_ACTIONS = [
  "retry",
  "cancel",
  "reauth",
  "edit_settings",
  "export_debug",
  "wait",
] as const;

export type QueueUserAction = (typeof QUEUE_USER_ACTIONS)[number];

const ACTIVE_QUEUE_STATUSES: QueueOperationStatus[] = [
  "pending",
  "executing",
  "retry_scheduled",
  "failed",
  "blocked",
];

type QueueInspectorStatusFilter = QueueOperationStatus | "active" | "all";

function isQueueOperationStatus(value: unknown): value is QueueOperationStatus {
  return typeof value === "string" && (QUEUE_OPERATION_STATUSES as readonly string[]).includes(value);
}

function isQueueUserAction(value: unknown): value is QueueUserAction {
  return typeof value === "string" && (QUEUE_USER_ACTIONS as readonly string[]).includes(value);
}

function normalizeQueueUserAction(value: unknown, fallback: QueueUserAction | null): QueueUserAction | null {
  return isQueueUserAction(value) ? value : fallback;
}

function normalizeQueueInspectorStatus(value: unknown): QueueInspectorStatusFilter {
  if (value === "active" || value === "all" || isQueueOperationStatus(value)) return value;
  return "active";
}

function normalizeQueueLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 200;
  return Math.min(500, Math.max(1, Math.trunc(value)));
}

function sanitizeQueueText(value: unknown, fallback: string | null = null, maxLength = 512): string | null {
  if (typeof value !== "string") return fallback;
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!sanitized) return fallback;
  return sanitized.slice(0, maxLength);
}

export interface PendingOperation {
  id: string;
  account_id: string;
  operation_type: string;
  resource_id: string;
  params: string;
  status: QueueOperationStatus;
  retry_count: number;
  max_retries: number;
  next_retry_at: number | null;
  created_at: number;
  error_message: string | null;
  blocked_reason?: string | null;
  diagnostic_code?: string | null;
  user_action?: string | null;
  updated_at?: number | null;
}

export interface QueueSummary {
  pending: number;
  executing: number;
  retryScheduled: number;
  failed: number;
  blocked: number;
  cancelled: number;
  active: number;
  total: number;
}

export interface QueueInspectorPreview {
  title: string;
  subtitle: string;
  fields: Array<{ label: string; value: string }>;
}

export interface QueueInspectorItem {
  id: string;
  accountId: string;
  operationType: string;
  resourceId: string;
  status: QueueOperationStatus;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: number | null;
  createdAt: number;
  updatedAt: number | null;
  lastError: string | null;
  blockedReason: string | null;
  diagnosticCode: string | null;
  userAction: string | null;
  preview: QueueInspectorPreview;
  actions: QueueUserAction[];
}

export async function enqueuePendingOperation(
  accountId: string,
  operationType: string,
  resourceId: string,
  params: Record<string, unknown>,
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO pending_operations (id, account_id, operation_type, resource_id, params)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, accountId, operationType, resourceId, JSON.stringify(params)],
  );
  return id;
}

export async function getPendingOperations(
  accountId?: string,
  limit = 50,
): Promise<PendingOperation[]> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  if (accountId) {
    return db.select<PendingOperation[]>(
      `SELECT * FROM pending_operations
       WHERE account_id = $1
         AND (
           (status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= $2))
           OR (status = 'retry_scheduled' AND next_retry_at <= $2)
         )
       ORDER BY created_at ASC LIMIT $3`,
      [accountId, now, limit],
    );
  }
  return db.select<PendingOperation[]>(
    `SELECT * FROM pending_operations
     WHERE (
       (status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= $1))
       OR (status = 'retry_scheduled' AND next_retry_at <= $1)
     )
     ORDER BY created_at ASC LIMIT $2`,
    [now, limit],
  );
}

export async function updateOperationStatus(
  id: string,
  status: QueueOperationStatus,
  errorMessage?: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE pending_operations
     SET status = $1,
         error_message = $2,
         updated_at = unixepoch(),
         blocked_reason = CASE WHEN $1 = 'blocked' THEN blocked_reason ELSE NULL END,
         diagnostic_code = CASE WHEN $1 IN ('blocked', 'failed') THEN diagnostic_code ELSE NULL END,
         user_action = CASE WHEN $1 = 'blocked' THEN user_action ELSE NULL END
     WHERE id = $3`,
    [status, errorMessage ?? null, id],
  );
}

export async function blockOperation(
  id: string,
  reason: string,
  options: {
    diagnosticCode?: string;
    userAction?: QueueUserAction | string;
    errorMessage?: string;
  } = {},
): Promise<void> {
  const db = await getDb();
  const blockedReason = sanitizeQueueText(reason, "blocked") ?? "blocked";
  const errorMessage = sanitizeQueueText(options.errorMessage, blockedReason) ?? blockedReason;
  const diagnosticCode = sanitizeQueueText(options.diagnosticCode, null, 128);
  const userAction = normalizeQueueUserAction(options.userAction, "retry");
  await db.execute(
    `UPDATE pending_operations
     SET status = 'blocked',
         error_message = $1,
         blocked_reason = $2,
         diagnostic_code = $3,
         user_action = $4,
         updated_at = unixepoch()
     WHERE id = $5`,
    [
      errorMessage,
      blockedReason,
      diagnosticCode,
      userAction,
      id,
    ],
  );
}

export async function failOperation(
  id: string,
  errorMessage: string,
  options: {
    diagnosticCode?: string;
    userAction?: QueueUserAction | string;
  } = {},
): Promise<void> {
  const db = await getDb();
  const sanitizedErrorMessage = sanitizeQueueText(errorMessage, "Operation failed") ?? "Operation failed";
  const diagnosticCode = sanitizeQueueText(options.diagnosticCode, null, 128);
  const userAction = normalizeQueueUserAction(options.userAction, null);
  await db.execute(
    `UPDATE pending_operations
     SET status = 'failed',
         error_message = $1,
         blocked_reason = NULL,
         diagnostic_code = $2,
         user_action = $3,
         updated_at = unixepoch()
     WHERE id = $4`,
    [
      sanitizedErrorMessage,
      diagnosticCode,
      userAction,
      id,
    ],
  );
}

export async function deleteOperation(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM pending_operations WHERE id = $1`, [id]);
}

const BACKOFF_SCHEDULE = [60, 300, 900, 3600];

export async function incrementRetry(id: string): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ retry_count: number; max_retries: number }[]>(
    `SELECT retry_count, max_retries FROM pending_operations WHERE id = $1`,
    [id],
  );
  const op = rows[0];
  if (!op) return;

  const newCount = op.retry_count + 1;
  if (newCount >= op.max_retries) {
    await db.execute(
      `UPDATE pending_operations
       SET status = 'failed', retry_count = $1, updated_at = unixepoch()
       WHERE id = $2`,
      [newCount, id],
    );
    return;
  }

  const backoffIdx = Math.min(newCount - 1, BACKOFF_SCHEDULE.length - 1);
  const delaySec = BACKOFF_SCHEDULE[backoffIdx]!;
  const nextRetryAt = Math.floor(Date.now() / 1000) + delaySec;

  await db.execute(
    `UPDATE pending_operations
     SET status = 'retry_scheduled',
         retry_count = $1,
         next_retry_at = $2,
         updated_at = unixepoch()
     WHERE id = $3`,
    [newCount, nextRetryAt, id],
  );
}

export async function getPendingOpsCount(accountId?: string): Promise<number> {
  const db = await getDb();
  if (accountId) {
    const rows = await db.select<{ count: number }[]>(
      `SELECT COUNT(*) as count
       FROM pending_operations
       WHERE account_id = $1 AND status IN ('pending', 'retry_scheduled')`,
      [accountId],
    );
    return rows[0]?.count ?? 0;
  }
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count
     FROM pending_operations
     WHERE status IN ('pending', 'retry_scheduled')`,
  );
  return rows[0]?.count ?? 0;
}

export async function getFailedOpsCount(accountId?: string): Promise<number> {
  const db = await getDb();
  if (accountId) {
    const rows = await db.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM pending_operations WHERE account_id = $1 AND status = 'failed'`,
      [accountId],
    );
    return rows[0]?.count ?? 0;
  }
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM pending_operations WHERE status = 'failed'`,
  );
  return rows[0]?.count ?? 0;
}

const OUTBOX_SEND_STATUSES = ["pending", "executing", "retry_scheduled", "failed", "blocked"] as const;

/** Pending/failed send operations for the Outbox view (sendMessage only). */
export async function getOutboxSendOperations(
  accountId?: string,
  limit = 100,
): Promise<PendingOperation[]> {
  const db = await getDb();
  const statusPlaceholders = OUTBOX_SEND_STATUSES.map((_, i) => `$${i + 1}`).join(", ");
  if (accountId) {
    return db.select<PendingOperation[]>(
      `SELECT * FROM pending_operations
       WHERE account_id = $${OUTBOX_SEND_STATUSES.length + 1}
         AND operation_type = 'sendMessage'
         AND status IN (${statusPlaceholders})
       ORDER BY created_at DESC
       LIMIT $${OUTBOX_SEND_STATUSES.length + 2}`,
      [...OUTBOX_SEND_STATUSES, accountId, limit],
    );
  }
  return db.select<PendingOperation[]>(
    `SELECT * FROM pending_operations
     WHERE operation_type = 'sendMessage'
       AND status IN (${statusPlaceholders})
     ORDER BY created_at DESC
     LIMIT $${OUTBOX_SEND_STATUSES.length + 1}`,
    [...OUTBOX_SEND_STATUSES, limit],
  );
}

export async function retryOutboxOperation(id: string): Promise<void> {
  await retryOperation(id, { operationType: "sendMessage" });
}

export async function cancelOutboxOperation(id: string): Promise<void> {
  await cancelOperation(id, { operationType: "sendMessage" });
}

export async function retryOperation(
  id: string,
  options: { operationType?: string } = {},
): Promise<void> {
  const db = await getDb();
  const operationFilter = options.operationType ? "AND operation_type = $2" : "";
  const params = options.operationType ? [id, options.operationType] : [id];
  await db.execute(
    `UPDATE pending_operations
     SET status = 'pending',
         retry_count = 0,
         next_retry_at = NULL,
         error_message = NULL,
         blocked_reason = NULL,
         diagnostic_code = NULL,
         user_action = NULL,
         updated_at = unixepoch()
     WHERE id = $1 ${operationFilter}`,
    params,
  );
}

export async function cancelOperation(
  id: string,
  options: { operationType?: string } = {},
): Promise<void> {
  const db = await getDb();
  const operationFilter = options.operationType ? "AND operation_type = $2" : "";
  const params = options.operationType ? [id, options.operationType] : [id];
  await db.execute(
    `UPDATE pending_operations
     SET status = 'cancelled',
         error_message = NULL,
         blocked_reason = NULL,
         user_action = NULL,
         updated_at = unixepoch()
     WHERE id = $1 ${operationFilter}`,
    params,
  );
}

export async function getPendingOpsForResource(
  accountId: string,
  resourceId: string,
): Promise<PendingOperation[]> {
  const db = await getDb();
  return db.select<PendingOperation[]>(
    `SELECT * FROM pending_operations
     WHERE account_id = $1 AND resource_id = $2 AND status IN ('pending', 'retry_scheduled')
     ORDER BY created_at ASC`,
    [accountId, resourceId],
  );
}

export async function compactQueue(accountId?: string): Promise<number> {
  const db = await getDb();

  const ops = accountId
    ? await db.select<PendingOperation[]>(
      `SELECT * FROM pending_operations
       WHERE status = 'pending' AND account_id = $1
       ORDER BY created_at ASC`,
      [accountId],
    )
    : await db.select<PendingOperation[]>(
      `SELECT * FROM pending_operations
       WHERE status = 'pending'
       ORDER BY created_at ASC`,
    );

  // Group by resource_id
  const byResource = new Map<string, PendingOperation[]>();
  for (const op of ops) {
    const key = `${op.account_id}:${op.resource_id}`;
    const list = byResource.get(key) ?? [];
    list.push(op);
    byResource.set(key, list);
  }

  const toDelete: string[] = [];

  for (const [, resourceOps] of byResource) {
    // Cancel out toggle pairs: star(true)+star(false), markRead(true)+markRead(false)
    for (const toggleType of ["star", "markRead"]) {
      const toggleOps = resourceOps.filter(
        (o) => o.operation_type === toggleType,
      );
      // If two ops with opposite values exist, remove both
      while (toggleOps.length >= 2) {
        const a = toggleOps.shift()!;
        const b = toggleOps.shift()!;
        const paramsA = JSON.parse(a.params);
        const paramsB = JSON.parse(b.params);
        if (
          (toggleType === "star" && paramsA.starred !== paramsB.starred) ||
          (toggleType === "markRead" && paramsA.read !== paramsB.read)
        ) {
          toDelete.push(a.id, b.id);
        }
      }
    }

    // Cancel addLabel+removeLabel for same label on same resource
    const addLabelOps = resourceOps.filter(
      (o) => o.operation_type === "addLabel",
    );
    const removeLabelOps = resourceOps.filter(
      (o) => o.operation_type === "removeLabel",
    );
    for (const addOp of addLabelOps) {
      const addParams = JSON.parse(addOp.params);
      const matchIdx = removeLabelOps.findIndex((r) => {
        const rParams = JSON.parse(r.params);
        return rParams.labelId === addParams.labelId;
      });
      if (matchIdx !== -1) {
        toDelete.push(addOp.id, removeLabelOps[matchIdx]!.id);
        removeLabelOps.splice(matchIdx, 1);
      }
    }

    // Collapse sequential moves: keep only the latest moveToFolder
    const moveOps = resourceOps.filter(
      (o) => o.operation_type === "moveToFolder",
    );
    if (moveOps.length > 1) {
      // Delete all but the last
      for (let i = 0; i < moveOps.length - 1; i++) {
        toDelete.push(moveOps[i]!.id);
      }
    }
  }

  // Delete compacted ops
  if (toDelete.length > 0) {
    const placeholders = toDelete.map((_, i) => `$${i + 1}`).join(",");
    await db.execute(
      `DELETE FROM pending_operations WHERE id IN (${placeholders})`,
      toDelete,
    );
  }

  return toDelete.length;
}

export async function clearFailedOperations(accountId?: string): Promise<void> {
  const db = await getDb();
  if (accountId) {
    await db.execute(
      `DELETE FROM pending_operations WHERE account_id = $1 AND status = 'failed'`,
      [accountId],
    );
  } else {
    await db.execute(`DELETE FROM pending_operations WHERE status = 'failed'`);
  }
}

export async function retryFailedOperations(accountId?: string): Promise<void> {
  const db = await getDb();
  if (accountId) {
    await db.execute(
      `UPDATE pending_operations SET status = 'pending', retry_count = 0, next_retry_at = NULL, error_message = NULL
       WHERE account_id = $1 AND status IN ('failed', 'blocked')`,
      [accountId],
    );
  } else {
    await db.execute(
      `UPDATE pending_operations SET status = 'pending', retry_count = 0, next_retry_at = NULL, error_message = NULL
       WHERE status IN ('failed', 'blocked')`,
    );
  }
}

function emptyQueueSummary(): QueueSummary {
  return {
    pending: 0,
    executing: 0,
    retryScheduled: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
    active: 0,
    total: 0,
  };
}

function normalizeStatusForDisplay(op: PendingOperation, now = Math.floor(Date.now() / 1000)): QueueOperationStatus {
  if (op.status === "pending" && op.next_retry_at !== null && op.next_retry_at > now) {
    return "retry_scheduled";
  }
  if (QUEUE_OPERATION_STATUSES.includes(op.status)) {
    return op.status;
  }
  return "failed";
}

export async function getQueueSummary(accountId?: string): Promise<QueueSummary> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const rows = accountId
    ? await db.select<{ status: QueueOperationStatus; count: number }[]>(
      `SELECT
         CASE
           WHEN status = 'pending' AND next_retry_at IS NOT NULL AND next_retry_at > $2 THEN 'retry_scheduled'
           ELSE status
         END as status,
         COUNT(*) as count
       FROM pending_operations
       WHERE account_id = $1
       GROUP BY 1`,
      [accountId, now],
    )
    : await db.select<{ status: QueueOperationStatus; count: number }[]>(
      `SELECT
         CASE
           WHEN status = 'pending' AND next_retry_at IS NOT NULL AND next_retry_at > $1 THEN 'retry_scheduled'
           ELSE status
         END as status,
         COUNT(*) as count
       FROM pending_operations
       GROUP BY 1`,
      [now],
    );

  const summary = emptyQueueSummary();
  for (const row of rows) {
    const count = Number(row.count) || 0;
    switch (row.status) {
      case "pending":
        summary.pending += count;
        break;
      case "executing":
        summary.executing += count;
        break;
      case "retry_scheduled":
        summary.retryScheduled += count;
        break;
      case "failed":
        summary.failed += count;
        break;
      case "blocked":
        summary.blocked += count;
        break;
      case "cancelled":
        summary.cancelled += count;
        break;
    }
    summary.total += count;
  }
  summary.active = summary.pending + summary.executing + summary.retryScheduled + summary.failed + summary.blocked;
  return summary;
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseParams(paramsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(paramsJson);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function previewForOperation(op: PendingOperation): QueueInspectorPreview {
  const params = parseParams(op.params);
  if (op.operation_type === "sendMessage") {
    const preview = parseOutboxSendPreview(op.params);
    return {
      title: preview.subject,
      subtitle: preview.recipient,
      fields: [
        { label: "Тип", value: "Отправка письма" },
        { label: "Получатель", value: preview.recipient },
      ],
    };
  }

  const threadId = safeString(params.threadId);
  const folderPath = safeString(params.folderPath);
  const labelId = safeString(params.labelId);
  const draftId = safeString(params.draftId);
  const fields: QueueInspectorPreview["fields"] = [];
  if (threadId) fields.push({ label: "Thread", value: threadId });
  if (folderPath) fields.push({ label: "Папка", value: folderPath });
  if (labelId) fields.push({ label: "Label", value: labelId });
  if (draftId) fields.push({ label: "Draft", value: draftId });

  return {
    title: operationLabel(op.operation_type),
    subtitle: op.resource_id || "—",
    fields,
  };
}

export function operationLabel(operationType: string): string {
  switch (operationType) {
    case "archive":
      return "Архивировать";
    case "trash":
      return "Переместить в корзину";
    case "permanentDelete":
      return "Удалить навсегда";
    case "markRead":
      return "Изменить прочитанность";
    case "star":
      return "Изменить отметку";
    case "spam":
      return "Изменить спам-статус";
    case "moveToFolder":
      return "Переместить в папку";
    case "addLabel":
      return "Добавить метку";
    case "removeLabel":
      return "Убрать метку";
    case "sendMessage":
      return "Отправить письмо";
    case "createDraft":
      return "Создать черновик";
    case "updateDraft":
      return "Обновить черновик";
    case "deleteDraft":
      return "Удалить черновик";
    default:
      return operationType;
  }
}

function actionsForOperation(op: PendingOperation, status: QueueOperationStatus): QueueUserAction[] {
  if (status === "cancelled" || status === "executing") return [];
  if (status === "blocked") {
    const action = op.user_action === "reauth" || op.user_action === "edit_settings" || op.user_action === "export_debug" || op.user_action === "wait"
      ? op.user_action
      : "retry";
    return Array.from(new Set<QueueUserAction>([action, "retry", "cancel", "export_debug"]));
  }
  if (status === "failed") {
    return ["retry", "cancel", "edit_settings", "export_debug"];
  }
  if (status === "retry_scheduled" || status === "pending") {
    return ["retry", "cancel"];
  }
  return [];
}

export function toQueueInspectorItem(op: PendingOperation): QueueInspectorItem {
  const status = normalizeStatusForDisplay(op);
  return {
    id: op.id,
    accountId: op.account_id,
    operationType: op.operation_type,
    resourceId: op.resource_id,
    status,
    retryCount: op.retry_count,
    maxRetries: op.max_retries,
    nextRetryAt: op.next_retry_at,
    createdAt: op.created_at,
    updatedAt: op.updated_at ?? null,
    lastError: op.error_message,
    blockedReason: op.blocked_reason ?? null,
    diagnosticCode: op.diagnostic_code ?? null,
    userAction: op.user_action ?? null,
    preview: previewForOperation(op),
    actions: actionsForOperation(op, status),
  };
}

export async function listQueueInspectorOperations(options: {
  accountId?: string;
  status?: QueueInspectorStatusFilter;
  limit?: number;
} = {}): Promise<QueueInspectorItem[]> {
  const db = await getDb();
  const status = normalizeQueueInspectorStatus(options.status);
  const limit = normalizeQueueLimit(options.limit);
  const params: Array<string | number> = [];
  const where: string[] = [];

  if (options.accountId) {
    params.push(options.accountId);
    where.push(`account_id = $${params.length}`);
  }

  if (status === "active") {
    const placeholders = ACTIVE_QUEUE_STATUSES.map((s) => {
      params.push(s);
      return `$${params.length}`;
    }).join(", ");
    where.push(`status IN (${placeholders})`);
  } else if (status !== "all") {
    params.push(status);
    where.push(`status = $${params.length}`);
  }

  params.push(limit);
  const rows = await db.select<PendingOperation[]>(
    `SELECT * FROM pending_operations
     ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY
       CASE status
         WHEN 'blocked' THEN 0
         WHEN 'failed' THEN 1
         WHEN 'executing' THEN 2
         WHEN 'pending' THEN 3
         WHEN 'retry_scheduled' THEN 4
         ELSE 5
       END,
       created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows.map(toQueueInspectorItem);
}
