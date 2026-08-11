import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Clock, Loader2, RefreshCw, Send, XCircle } from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { useUIStore } from "@/stores/uiStore";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import {
  deleteOperation,
  getOutboxSendOperations,
  retryOutboxOperation,
  cancelOutboxOperation,
  type PendingOperation,
} from "@/services/db/pendingOperations";
import { triggerQueueFlush } from "@/services/queue/queueProcessor";
import { parseOutboxSendPreview } from "@/utils/outboxSendPreview";
import { EmptyState } from "@/components/ui/EmptyState";
import { GenericEmptyIllustration } from "@/components/ui/illustrations";
import {
  cancelQueuedComposeSend,
  restoreCompose,
} from "@/services/composer/composeSendOrchestrator";
import { useSendStatusStore } from "@/stores/sendStatusStore";
import type { ComposeSendRestore } from "@/stores/sendStatusStore";
import type { ComposerMode } from "@/stores/composerStore";

export type OutboxDisplayStatus = "pending" | "sending" | "retry_scheduled" | "failed" | "blocked";

function mapOutboxStatus(op: PendingOperation): OutboxDisplayStatus {
  if (op.status === "executing" || op.status === "sending") return "sending";
  if (op.status === "failed") return "failed";
  if (op.status === "blocked") return "blocked";
  if (op.status === "retry_scheduled" || (op.status === "pending" && op.next_retry_at && op.next_retry_at > Math.floor(Date.now() / 1000))) {
    return "retry_scheduled";
  }
  return "pending";
}

function statusLabel(status: OutboxDisplayStatus, op?: PendingOperation): string {
  switch (status) {
    case "pending":
      return "Ожидает отправки";
    case "sending":
      return "Отправляется";
    case "retry_scheduled":
      return "Повтор запланирован";
    case "failed":
      return "Ошибка отправки";
    case "blocked":
      return "Нужны действия";
  }
}

function formatOutboxDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString();
}

function parseRestoreFromParams(paramsJson: string): ComposeSendRestore | null {
  try {
    const params = JSON.parse(paramsJson) as { restore?: ComposeSendRestore };
    const restore = params.restore;
    if (!restore || !Array.isArray(restore.to)) return null;
    return {
      mode: (restore.mode as ComposerMode) ?? "new",
      to: restore.to,
      cc: restore.cc ?? [],
      bcc: restore.bcc ?? [],
      subject: restore.subject ?? "",
      bodyHtml: restore.bodyHtml ?? "",
      threadId: restore.threadId ?? null,
      inReplyToMessageId: restore.inReplyToMessageId ?? null,
      draftId: restore.draftId ?? null,
      fromEmail: restore.fromEmail ?? null,
    };
  } catch {
    return null;
  }
}

function emitOutboxChanged(): void {
  window.dispatchEvent(new Event("velo-outbox-changed"));
}

export function OutboxList() {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const pendingOpsCount = useUIStore((s) => s.pendingOpsCount);
  const openMenu = useContextMenuStore((s) => s.openMenu);
  const [items, setItems] = useState<PendingOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeAccountId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const ops = await getOutboxSendOperations(activeAccountId);
      const seen = new Set<string>();
      const deduped: PendingOperation[] = [];
      for (const op of ops) {
        const key = op.id || op.resource_id;
        if (seen.has(key)) continue;
        seen.add(key);
        if (op.resource_id) seen.add(op.resource_id);
        deduped.push(op);
      }
      setItems(deduped);
    } catch (err) {
      console.error("[OutboxList] failed to load:", err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [activeAccountId]);

  useEffect(() => {
    void load();
  }, [load, pendingOpsCount]);

  useEffect(() => {
    const handler = () => void load();
    window.addEventListener("velo-sync-done", handler);
    window.addEventListener("velo-outbox-changed", handler);
    return () => {
      window.removeEventListener("velo-sync-done", handler);
      window.removeEventListener("velo-outbox-changed", handler);
    };
  }, [load]);

  const handleRetry = useCallback(async (id: string) => {
    setRetryingId(id);
    try {
      await retryOutboxOperation(id);
      await triggerQueueFlush();
      await load();
    } catch (err) {
      console.error("[OutboxList] retry failed:", err);
    } finally {
      setRetryingId(null);
    }
  }, [load]);

  const handleCancel = useCallback(async (id: string) => {
    setCancellingId(id);
    try {
      await cancelOutboxOperation(id);
      window.dispatchEvent(new Event("velo-queue-changed"));
      window.dispatchEvent(new Event("velo-outbox-changed"));
      await load();
    } catch (err) {
      console.error("[OutboxList] cancel failed:", err);
    } finally {
      setCancellingId(null);
    }
  }, [load]);

  if (!activeAccountId) {
    return (
      <EmptyState
        illustration={GenericEmptyIllustration}
        title="No account connected"
        subtitle="Add a mail account"
      />
    );
  }

  if (loading && items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-12 text-text-tertiary">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Send}
        title="Нет писем, ожидающих отправки"
        subtitle="Очередь и ошибки отправки появятся здесь"
      />
    );
  }

  return (
    <ul className="divide-y divide-border-secondary">
      {items.map((op) => {
        const preview = parseOutboxSendPreview(op.params);
        const displayStatus = mapOutboxStatus(op);
        const canRetry = displayStatus === "failed" || displayStatus === "blocked";
        const canCancel = displayStatus === "failed" || displayStatus === "blocked" || displayStatus === "retry_scheduled";
        return (
          <li
            key={op.id}
            className="px-4 py-3 hover:bg-bg-hover transition-colors"
            data-office360-context-menu-source
            onContextMenu={(e) => handleContextMenu(e, op)}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0 text-accent">
                {displayStatus === "sending" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : displayStatus === "retry_scheduled" ? (
                  <Clock size={16} className="text-amber-600" />
                ) : displayStatus === "failed" ? (
                  <AlertCircle size={16} className="text-danger" />
                ) : displayStatus === "blocked" ? (
                  <AlertCircle size={16} className="text-danger" />
                ) : (
                  <Send size={16} />
                )}
              </div>
              <button
                type="button"
                disabled={!canOpen}
                onClick={() => void handleOpen(op)}
                className={`min-w-0 flex-1 text-left ${canOpen ? "cursor-pointer" : "cursor-default opacity-80"}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-text-primary truncate">
                    {preview.subject}
                  </span>
                  <span
                    className={`shrink-0 text-[0.625rem] font-medium px-1.5 py-0.5 rounded-full ${
                      displayStatus === "failed"
                        ? "bg-danger/15 text-danger"
                        : displayStatus === "blocked"
                          ? "bg-danger/15 text-danger"
                        : displayStatus === "sending"
                          ? "bg-accent/15 text-accent"
                          : displayStatus === "retry_scheduled"
                            ? "bg-amber-500/15 text-amber-700"
                          : "bg-bg-tertiary text-text-secondary"
                    }`}
                  >
                    {statusLabel(displayStatus, op)}
                  </span>
                </div>
                <p className="text-xs text-text-secondary truncate mt-0.5">
                  {preview.recipient}
                </p>
                <p className="text-xs text-text-tertiary mt-1">
                  {formatOutboxDate(op.created_at)}
                </p>
                {op.next_retry_at && displayStatus === "retry_scheduled" && (
                  <p className="text-xs text-text-tertiary mt-1">
                    Следующая попытка: {formatOutboxDate(op.next_retry_at)}
                  </p>
                )}
                {op.error_message && (displayStatus === "failed" || displayStatus === "blocked") && (
                  <p className="text-xs text-danger mt-1 break-words">
                    {op.error_message}
                  </p>
                )}
              </div>
              {(canRetry || canCancel) && (
                <div className="flex shrink-0 items-center gap-1">
                  {canRetry && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRetry(op.id);
                  }}
                  disabled={retryingId === op.id}
                  className="shrink-0 flex items-center gap-1 text-xs text-accent hover:text-accent/80 disabled:opacity-50 press-scale px-2 py-1 rounded"
                >
                  <RefreshCw size={14} className={retryingId === op.id ? "animate-spin" : ""} />
                  Повторить
                </button>
                  )}
                  {canCancel && (
                    <button
                      type="button"
                      onClick={() => void handleCancel(op.id)}
                      disabled={cancellingId === op.id}
                      className="shrink-0 flex items-center gap-1 text-xs text-text-tertiary hover:text-danger disabled:opacity-50 press-scale px-2 py-1 rounded"
                    >
                      <XCircle size={14} />
                      Отменить
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
