import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import {
  cancelOperation,
  getQueueSummary,
  listQueueInspectorOperations,
  retryOperation,
  type QueueInspectorItem,
  type QueueOperationStatus,
  type QueueSummary,
} from "@/services/db/pendingOperations";
import { triggerQueueFlush } from "@/services/queue/queueProcessor";
import { navigateBackFromQueueInspector } from "@/router/navigate";
import { Button } from "@/components/ui/Button";

type StatusFilter = QueueOperationStatus | "active" | "all";

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "active", label: "Активные" },
  { id: "pending", label: "Pending" },
  { id: "retry_scheduled", label: "Retry" },
  { id: "failed", label: "Failed" },
  { id: "blocked", label: "Blocked" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "Все" },
];

function statusLabel(status: QueueOperationStatus): string {
  switch (status) {
    case "pending":
      return "Ожидает";
    case "executing":
      return "Выполняется";
    case "retry_scheduled":
      return "Повтор запланирован";
    case "failed":
      return "Ошибка";
    case "blocked":
      return "Нужен выбор";
    case "cancelled":
      return "Отменено";
  }
}

function statusIcon(status: QueueOperationStatus) {
  switch (status) {
    case "executing":
      return <Loader2 size={16} className="animate-spin text-accent" />;
    case "retry_scheduled":
      return <Clock size={16} className="text-amber-600" />;
    case "failed":
      return <AlertCircle size={16} className="text-danger" />;
    case "blocked":
      return <ShieldAlert size={16} className="text-danger" />;
    case "cancelled":
      return <Ban size={16} className="text-text-tertiary" />;
    case "pending":
      return <Play size={16} className="text-accent" />;
  }
}

function statusClasses(status: QueueOperationStatus): string {
  switch (status) {
    case "failed":
    case "blocked":
      return "bg-danger/10 text-danger";
    case "retry_scheduled":
      return "bg-amber-500/10 text-amber-700";
    case "executing":
      return "bg-accent/10 text-accent";
    case "cancelled":
      return "bg-bg-tertiary text-text-tertiary";
    case "pending":
      return "bg-bg-tertiary text-text-secondary";
  }
}

function formatTime(unixSec: number | null): string {
  if (!unixSec) return "—";
  return new Date(unixSec * 1000).toLocaleString();
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

export function QueueInspector() {
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const [accountId, setAccountId] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [items, setItems] = useState<QueueInspectorItem[]>([]);
  const [summary, setSummary] = useState<QueueSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (activeAccountId && accountId === "all") {
      setAccountId(activeAccountId);
    }
  }, [activeAccountId, accountId]);

  const selectedAccountId = accountId === "all" ? undefined : accountId;

  const accountLabel = useMemo(() => {
    const byId = new Map(accounts.map((account) => [account.id, account.email]));
    return (id: string) => byId.get(id) ?? id;
  }, [accounts]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextItems, nextSummary] = await Promise.all([
        listQueueInspectorOperations({ accountId: selectedAccountId, status }),
        getQueueSummary(selectedAccountId),
      ]);
      setItems(nextItems);
      setSummary(nextSummary);
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handler = () => void load();
    window.addEventListener("velo-queue-changed", handler);
    window.addEventListener("velo-outbox-changed", handler);
    window.addEventListener("velo-sync-health-changed", handler);
    return () => {
      window.removeEventListener("velo-queue-changed", handler);
      window.removeEventListener("velo-outbox-changed", handler);
      window.removeEventListener("velo-sync-health-changed", handler);
    };
  }, [load]);

  const refreshAfterAction = useCallback(async () => {
    window.dispatchEvent(new Event("velo-queue-changed"));
    window.dispatchEvent(new Event("velo-outbox-changed"));
    await load();
  }, [load]);

  const handleRetry = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await retryOperation(id);
      await triggerQueueFlush();
      await refreshAfterAction();
    } finally {
      setBusyId(null);
    }
  }, [refreshAfterAction]);

  const handleCancel = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await cancelOperation(id);
      await refreshAfterAction();
    } finally {
      setBusyId(null);
    }
  }, [refreshAfterAction]);

  return (
    <div className="flex-1 overflow-y-auto bg-bg-primary/50">
      <div className="border-b border-border-primary bg-bg-primary/60 px-5 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigateBackFromQueueInspector()} className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary" title="Назад">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-text-primary">Queue Inspector</h1>
            <p className="text-xs text-text-tertiary">Offline и sync операции без raw MIME и секретов</p>
          </div>
          <Button className="ml-auto" variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void load()} disabled={loading}>
            Обновить
          </Button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1120px] px-6 py-5">
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(220px,280px)_1fr]">
          <div className="rounded-lg border border-border-primary bg-bg-secondary/70 p-3">
            <label className="text-xs font-medium text-text-tertiary" htmlFor="queue-account-filter">Аккаунт</label>
            <select
              id="queue-account-filter"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="mt-1 w-full rounded-md border border-border-primary bg-bg-primary px-2 py-1.5 text-sm text-text-primary"
            >
              <option value="all">Все аккаунты</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.email}</option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border border-border-primary bg-bg-secondary/70 p-3">
            <div className="mb-2 flex flex-wrap gap-2">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setStatus(filter.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    status === filter.id
                      ? "bg-accent text-white"
                      : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary md:grid-cols-5">
              <span>Pending: <b className="text-text-primary">{summary.pending}</b></span>
              <span>Retry: <b className="text-text-primary">{summary.retryScheduled}</b></span>
              <span>Failed: <b className="text-text-primary">{summary.failed}</b></span>
              <span>Blocked: <b className="text-text-primary">{summary.blocked}</b></span>
              <span>Active: <b className="text-text-primary">{summary.active}</b></span>
            </div>
          </div>
        </div>

        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-text-tertiary">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-border-primary bg-bg-secondary/70 p-8 text-center text-sm text-text-tertiary">
            Операций в выбранном фильтре нет.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <article key={item.id} className="rounded-lg border border-border-primary bg-bg-secondary/70 p-3">
                <div className="flex items-start gap-3">
                  <div className="mt-1">{statusIcon(item.status)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-text-primary">{item.preview.title}</h2>
                      <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${statusClasses(item.status)}`}>
                        {statusLabel(item.status)}
                      </span>
                      <span className="rounded-full bg-bg-tertiary px-2 py-0.5 text-[0.65rem] text-text-tertiary">
                        {item.operationType}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-text-secondary">{item.preview.subtitle}</p>
                    <dl className="mt-3 grid gap-2 text-[0.7rem] text-text-secondary sm:grid-cols-2 lg:grid-cols-4">
                      <div><dt className="text-text-tertiary">Account</dt><dd className="truncate font-medium text-text-primary">{accountLabel(item.accountId)}</dd></div>
                      <div><dt className="text-text-tertiary">Resource</dt><dd className="truncate font-medium text-text-primary">{item.resourceId}</dd></div>
                      <div><dt className="text-text-tertiary">Created</dt><dd>{formatTime(item.createdAt)}</dd></div>
                      <div><dt className="text-text-tertiary">Next retry</dt><dd>{formatTime(item.nextRetryAt)}</dd></div>
                      <div><dt className="text-text-tertiary">Retries</dt><dd>{item.retryCount}/{item.maxRetries}</dd></div>
                      <div><dt className="text-text-tertiary">Diagnostic</dt><dd className="truncate">{item.diagnosticCode ?? "—"}</dd></div>
                    </dl>
                    {item.preview.fields.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2 text-[0.7rem] text-text-tertiary">
                        {item.preview.fields.map((field) => (
                          <span key={`${field.label}:${field.value}`} className="rounded bg-bg-tertiary px-2 py-1">
                            {field.label}: <b className="text-text-secondary">{field.value}</b>
                          </span>
                        ))}
                      </div>
                    )}
                    {(item.blockedReason || item.lastError) && (
                      <p className="mt-2 break-words rounded-md bg-bg-primary/70 px-2 py-1.5 text-xs text-danger">
                        {item.blockedReason ?? item.lastError}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {item.actions.includes("retry") && (
                      <Button
                        size="xs"
                        variant="secondary"
                        icon={<RotateCcw size={13} className={busyId === item.id ? "animate-spin" : ""} />}
                        onClick={() => void handleRetry(item.id)}
                        disabled={busyId === item.id}
                      >
                        Retry
                      </Button>
                    )}
                    {item.actions.includes("cancel") && (
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={<XCircle size={13} />}
                        onClick={() => void handleCancel(item.id)}
                        disabled={busyId === item.id}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
