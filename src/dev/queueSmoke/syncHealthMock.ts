import { getQueueSummary, type QueueSummary } from "./pendingOperationsMock";

export type AccountSyncHealthStatus =
  | "healthy"
  | "syncing"
  | "queued"
  | "offline"
  | "degraded"
  | "failed";

export interface AccountSyncHealth {
  accountId: string;
  status: AccountSyncHealthStatus;
  statusLabel: string;
  queue: QueueSummary;
  lastAttemptAt: number | null;
  lastSuccessfulSyncAt: number | null;
  blockedReason?: string;
  diagnosticCode?: string;
}

const accountHealth: Record<string, Omit<AccountSyncHealth, "queue">> = {
  "acct-yandex": {
    accountId: "acct-yandex",
    status: "failed",
    statusLabel: "Требуется действие",
    lastAttemptAt: Math.floor(Date.now() / 1000) - 120,
    lastSuccessfulSyncAt: Math.floor(Date.now() / 1000) - 7200,
    blockedReason: "Нужно переподключить аккаунт.",
    diagnosticCode: "AUTH_EXPIRED_TOKEN",
  },
  "acct-gmail": {
    accountId: "acct-gmail",
    status: "queued",
    statusLabel: "Есть операции в очереди",
    lastAttemptAt: Math.floor(Date.now() / 1000) - 60,
    lastSuccessfulSyncAt: Math.floor(Date.now() / 1000) - 1800,
    diagnosticCode: "NETWORK_RETRY",
  },
  "acct-localdb": {
    accountId: "acct-localdb",
    status: "degraded",
    statusLabel: "Ошибка локальной базы",
    lastAttemptAt: Math.floor(Date.now() / 1000) - 300,
    lastSuccessfulSyncAt: null,
    blockedReason: "Local database write failed.",
    diagnosticCode: "LOCAL_DB_WRITE_FAILED",
  },
};

export async function getAccountSyncHealth(accountId: string): Promise<AccountSyncHealth | null> {
  const base = accountHealth[accountId];
  if (!base) return null;
  return {
    ...base,
    queue: await getQueueSummary(accountId),
  };
}

export async function listAccountSyncHealth(accountIds?: string[]): Promise<AccountSyncHealth[]> {
  const ids = accountIds ?? Object.keys(accountHealth);
  const items = await Promise.all(ids.map((id) => getAccountSyncHealth(id)));
  return items.filter((item): item is AccountSyncHealth => item !== null);
}

export function recordSyncHealthStatus(accountId: string, status: "syncing" | "done" | "error"): void {
  const base = accountHealth[accountId];
  if (!base) return;
  if (status === "syncing") base.status = "syncing";
  if (status === "done") base.status = "healthy";
  if (status === "error") base.status = "failed";
}

export function syncHealthStatusLabel(status: AccountSyncHealthStatus): string {
  switch (status) {
    case "healthy":
      return "Синхронизирован";
    case "syncing":
      return "Синхронизация";
    case "queued":
      return "Есть очередь";
    case "offline":
      return "Офлайн";
    case "degraded":
      return "Частичная ошибка";
    case "failed":
      return "Требуется действие";
  }
}
