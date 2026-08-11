import { getAccount, getAllAccounts } from "@/services/db/accounts";
import { listAccountDiagnostics } from "@/services/db/accountDiagnostics";
import { getQueueSummary, type QueueSummary } from "@/services/db/pendingOperations";
import type { ConnectionDiagnostic, DiagnosticReason, DiagnosticUserAction } from "@/services/diagnostics";
import { useUIStore } from "@/stores/uiStore";
import type { SyncProgress } from "@/services/gmail/sync";

export type AccountSyncHealthStatus =
  | "healthy"
  | "syncing"
  | "queued"
  | "degraded"
  | "failed"
  | "offline";

export interface AccountSyncHealth {
  accountId: string;
  status: AccountSyncHealthStatus;
  lastSuccessfulSyncAt: number | null;
  lastAttemptAt: number | null;
  pendingCount: number;
  failedCount: number;
  blockedReason?: string;
  diagnosticCode?: string;
  userAction?: DiagnosticUserAction;
  queue: QueueSummary;
  progress?: SyncProgress;
}

const syncingAccounts = new Set<string>();
const lastAttemptByAccount = new Map<string, number>();
const progressByAccount = new Map<string, SyncProgress>();

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function recordSyncHealthStatus(
  accountId: string,
  status: "syncing" | "done" | "error",
  progress?: SyncProgress,
): void {
  lastAttemptByAccount.set(accountId, nowSec());
  if (status === "syncing") {
    syncingAccounts.add(accountId);
    if (progress) progressByAccount.set(accountId, progress);
  } else {
    syncingAccounts.delete(accountId);
    progressByAccount.delete(accountId);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("velo-sync-health-changed"));
  }
}

function isAuthReason(reason: DiagnosticReason): boolean {
  return reason === "invalid_credentials" ||
    reason === "expired_token" ||
    reason === "missing_scope";
}

function latestDiagnostic(diagnostics: ConnectionDiagnostic[]): ConnectionDiagnostic | null {
  return diagnostics
    .filter((diagnostic) => diagnostic.severity !== "info")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

function statusFromDiagnostic(diagnostic: ConnectionDiagnostic | null): AccountSyncHealthStatus | null {
  if (!diagnostic) return null;
  if (diagnostic.reason === "local_database_error") return "failed";
  if (isAuthReason(diagnostic.reason) || diagnostic.severity === "blocked") return "failed";
  if (diagnostic.severity === "error") return "degraded";
  return "degraded";
}

export async function getAccountSyncHealth(accountId: string): Promise<AccountSyncHealth | null> {
  const account = await getAccount(accountId);
  if (!account) return null;

  const [queue, diagnostics] = await Promise.all([
    getQueueSummary(accountId),
    listAccountDiagnostics(accountId),
  ]);
  const latest = latestDiagnostic(diagnostics);
  const pendingCount = queue.pending + queue.executing + queue.retryScheduled;
  const failedCount = queue.failed + queue.blocked;
  const lastAttemptAt = Math.max(
    lastAttemptByAccount.get(accountId) ?? 0,
    latest?.updatedAt ?? 0,
  ) || null;

  let status: AccountSyncHealthStatus = "healthy";
  if (!useUIStore.getState().isOnline && (queue.active > 0 || lastAttemptAt !== null)) {
    status = "offline";
  } else if (syncingAccounts.has(accountId)) {
    status = "syncing";
  } else if (failedCount > 0) {
    status = "failed";
  } else {
    status = statusFromDiagnostic(latest) ?? (pendingCount > 0 ? "queued" : "healthy");
  }

  return {
    accountId,
    status,
    lastSuccessfulSyncAt: account.last_sync_at,
    lastAttemptAt,
    pendingCount,
    failedCount,
    blockedReason: latest?.userMessage,
    diagnosticCode: latest?.debugCode,
    userAction: latest?.userAction,
    queue,
    progress: progressByAccount.get(accountId),
  };
}

export function syncProgressLabel(progress?: SyncProgress): string | null {
  if (!progress) return null;
  const phases: Record<SyncProgress["phase"], string> = {
    labels: "Папки",
    threads: "Переписки",
    messages: "Письма",
    done: "Завершение",
  };
  const stage = phases[progress.phase];
  return progress.total > 0 ? `${stage}: ${progress.current}/${progress.total}` : stage;
}

export async function listAccountSyncHealth(accountIds?: string[]): Promise<AccountSyncHealth[]> {
  const accounts = await getAllAccounts();
  const ids = accountIds ?? accounts.map((account) => account.id);
  const items = await Promise.all(ids.map((id) => getAccountSyncHealth(id)));
  return items.filter((item): item is AccountSyncHealth => item !== null);
}

export function syncHealthStatusLabel(status: AccountSyncHealthStatus): string {
  switch (status) {
    case "healthy":
      return "Здоров";
    case "syncing":
      return "Синхронизация";
    case "queued":
      return "В очереди";
    case "degraded":
      return "Проблемы sync";
    case "failed":
      return "Требует внимания";
    case "offline":
      return "Offline";
  }
}
