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
export type QueueUserAction = "retry" | "cancel" | "reauth" | "edit_settings" | "export_debug" | "wait";

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

function encodeRawEmail(to: string, subject: string, body: string): string {
  const raw = `To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`;
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const now = Math.floor(Date.now() / 1000);

function makeFixtures(): PendingOperation[] {
  return [
    {
      id: "op-send-failed",
      account_id: "acct-yandex",
      operation_type: "sendMessage",
      resource_id: "draft-yandex-1",
      params: JSON.stringify({
        rawBase64Url: encodeRawEmail("client@example.com", "Commercial proposal", "Private body must stay hidden"),
        token: "secret-token-must-not-render",
        password: "password-must-not-render",
      }),
      status: "failed",
      retry_count: 2,
      max_retries: 5,
      next_retry_at: null,
      created_at: now - 560,
      updated_at: now - 120,
      error_message: "SMTP server rejected the message. Check outgoing mail settings.",
      diagnostic_code: "SMTP_PERMANENT_FAILURE",
      user_action: "edit_settings",
    },
    {
      id: "op-auth-blocked",
      account_id: "acct-yandex",
      operation_type: "archive",
      resource_id: "thread-auth-1",
      params: JSON.stringify({
        threadId: "thread-auth-1",
        folderPath: "INBOX",
        oauth_client_secret: "oauth-secret-must-not-render",
      }),
      status: "blocked",
      retry_count: 1,
      max_retries: 3,
      next_retry_at: null,
      created_at: now - 420,
      updated_at: now - 90,
      error_message: "Token expired.",
      blocked_reason: "Нужно переподключить аккаунт.",
      diagnostic_code: "AUTH_EXPIRED_TOKEN",
      user_action: "reauth",
    },
    {
      id: "op-retry-send",
      account_id: "acct-gmail",
      operation_type: "sendMessage",
      resource_id: "draft-gmail-1",
      params: JSON.stringify({
        rawBase64Url: encodeRawEmail("team@example.com", "Retry scheduled message", "Hidden body"),
        authorization: "Bearer secret-must-not-render",
      }),
      status: "retry_scheduled",
      retry_count: 1,
      max_retries: 5,
      next_retry_at: now + 900,
      created_at: now - 300,
      updated_at: now - 60,
      error_message: "Temporary network failure.",
      diagnostic_code: "NETWORK_RETRY",
      user_action: "wait",
    },
    {
      id: "op-pending-label",
      account_id: "acct-gmail",
      operation_type: "addLabel",
      resource_id: "thread-label-1",
      params: JSON.stringify({
        threadId: "thread-label-1",
        labelId: "Label_Work",
        rawMime: "raw-mime-must-not-render",
      }),
      status: "pending",
      retry_count: 0,
      max_retries: 3,
      next_retry_at: null,
      created_at: now - 180,
      updated_at: null,
      error_message: null,
    },
    {
      id: "op-cancelled",
      account_id: "acct-yandex",
      operation_type: "moveToFolder",
      resource_id: "thread-cancelled-1",
      params: JSON.stringify({ threadId: "thread-cancelled-1", folderPath: "Archive" }),
      status: "cancelled",
      retry_count: 0,
      max_retries: 3,
      next_retry_at: null,
      created_at: now - 90,
      updated_at: now - 30,
      error_message: null,
    },
  ];
}

let operations = makeFixtures();

export function resetQueueSmokeFixtures(): void {
  operations = makeFixtures();
  emitQueueEvents();
}

function emitQueueEvents(): void {
  window.dispatchEvent(new Event("velo-queue-changed"));
  window.dispatchEvent(new Event("velo-outbox-changed"));
  window.dispatchEvent(new Event("velo-sync-health-changed"));
}

function normalizeStatus(op: PendingOperation): QueueOperationStatus {
  if (op.status === "pending" && op.next_retry_at && op.next_retry_at > Math.floor(Date.now() / 1000)) {
    return "retry_scheduled";
  }
  return op.status;
}

function emptySummary(): QueueSummary {
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

export async function getQueueSummary(accountId?: string): Promise<QueueSummary> {
  const summary = emptySummary();
  for (const op of operations) {
    if (accountId && op.account_id !== accountId) continue;
    const status = normalizeStatus(op);
    if (status === "pending") summary.pending += 1;
    if (status === "executing") summary.executing += 1;
    if (status === "retry_scheduled") summary.retryScheduled += 1;
    if (status === "failed") summary.failed += 1;
    if (status === "blocked") summary.blocked += 1;
    if (status === "cancelled") summary.cancelled += 1;
    summary.total += 1;
  }
  summary.active = summary.pending + summary.executing + summary.retryScheduled + summary.failed + summary.blocked;
  return summary;
}

export async function getPendingOpsCount(accountId?: string): Promise<number> {
  const summary = await getQueueSummary(accountId);
  return summary.pending + summary.retryScheduled;
}

export async function getFailedOpsCount(accountId?: string): Promise<number> {
  const summary = await getQueueSummary(accountId);
  return summary.failed + summary.blocked;
}

export async function getOutboxSendOperations(accountId: string): Promise<PendingOperation[]> {
  return operations
    .filter((op) => op.account_id === accountId && op.operation_type === "sendMessage")
    .filter((op) => ["pending", "executing", "retry_scheduled", "failed", "blocked"].includes(op.status))
    .sort((a, b) => b.created_at - a.created_at)
    .map((op) => ({ ...op }));
}

export async function retryOperation(id: string): Promise<void> {
  operations = operations.map((op) =>
    op.id === id
      ? {
        ...op,
        status: "pending",
        retry_count: 0,
        next_retry_at: null,
        error_message: null,
        blocked_reason: null,
        diagnostic_code: null,
        user_action: null,
        updated_at: Math.floor(Date.now() / 1000),
      }
      : op,
  );
  emitQueueEvents();
}

export async function cancelOperation(id: string): Promise<void> {
  operations = operations.map((op) =>
    op.id === id
      ? {
        ...op,
        status: "cancelled",
        error_message: null,
        blocked_reason: null,
        user_action: null,
        updated_at: Math.floor(Date.now() / 1000),
      }
      : op,
  );
  emitQueueEvents();
}

export async function retryOutboxOperation(id: string): Promise<void> {
  await retryOperation(id);
}

export async function cancelOutboxOperation(id: string): Promise<void> {
  await cancelOperation(id);
}

function operationLabel(operationType: string): string {
  switch (operationType) {
    case "sendMessage":
      return "Отправить письмо";
    case "archive":
      return "Архивировать";
    case "addLabel":
      return "Добавить метку";
    case "moveToFolder":
      return "Переместить в папку";
    default:
      return operationType;
  }
}

function previewForOperation(op: PendingOperation): QueueInspectorPreview {
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

  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(op.params) as Record<string, unknown>;
  } catch {
    params = {};
  }
  const fields: QueueInspectorPreview["fields"] = [];
  if (typeof params.threadId === "string") fields.push({ label: "Thread", value: params.threadId });
  if (typeof params.folderPath === "string") fields.push({ label: "Папка", value: params.folderPath });
  if (typeof params.labelId === "string") fields.push({ label: "Label", value: params.labelId });

  return {
    title: operationLabel(op.operation_type),
    subtitle: op.resource_id,
    fields,
  };
}

function actionsForStatus(status: QueueOperationStatus): QueueUserAction[] {
  if (status === "failed") return ["retry", "cancel", "edit_settings", "export_debug"];
  if (status === "blocked") return ["reauth", "retry", "cancel", "export_debug"];
  if (status === "pending" || status === "retry_scheduled") return ["retry", "cancel"];
  return [];
}

function toInspectorItem(op: PendingOperation): QueueInspectorItem {
  const status = normalizeStatus(op);
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
    actions: actionsForStatus(status),
  };
}

export async function listQueueInspectorOperations(options: {
  accountId?: string;
  status?: QueueOperationStatus | "active" | "all";
  limit?: number;
} = {}): Promise<QueueInspectorItem[]> {
  const statusFilter = options.status ?? "active";
  const limit = options.limit ?? 200;
  const activeStatuses: QueueOperationStatus[] = ["pending", "executing", "retry_scheduled", "failed", "blocked"];
  return operations
    .filter((op) => !options.accountId || op.account_id === options.accountId)
    .filter((op) => {
      const status = normalizeStatus(op);
      if (statusFilter === "all") return true;
      if (statusFilter === "active") return activeStatuses.includes(status);
      return status === statusFilter;
    })
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map(toInspectorItem);
}

export async function enqueuePendingOperation(): Promise<string> {
  const id = `op-smoke-${Date.now()}`;
  operations.unshift({
    id,
    account_id: "acct-yandex",
    operation_type: "archive",
    resource_id: "thread-smoke",
    params: JSON.stringify({ threadId: "thread-smoke" }),
    status: "pending",
    retry_count: 0,
    max_retries: 3,
    next_retry_at: null,
    created_at: Math.floor(Date.now() / 1000),
    error_message: null,
  });
  emitQueueEvents();
  return id;
}

export async function clearFailedOperations(): Promise<void> {
  operations = operations.filter((op) => op.status !== "failed");
  emitQueueEvents();
}

export async function retryFailedOperations(): Promise<void> {
  operations = operations.map((op) => ["failed", "blocked"].includes(op.status) ? { ...op, status: "pending", error_message: null } : op);
  emitQueueEvents();
}

export async function getPendingOperations(): Promise<PendingOperation[]> {
  return operations.filter((op) => ["pending", "retry_scheduled"].includes(op.status)).map((op) => ({ ...op }));
}

export async function getPendingOpsForResource(): Promise<PendingOperation[]> {
  return [];
}

export async function updateOperationStatus(): Promise<void> {}
export async function deleteOperation(): Promise<void> {}
export async function incrementRetry(): Promise<void> {}
export async function compactQueue(): Promise<number> { return 0; }
export async function blockOperation(): Promise<void> {}
export async function failOperation(): Promise<void> {}
