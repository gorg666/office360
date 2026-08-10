import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, RefreshCw, Send } from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { useUIStore } from "@/stores/uiStore";
import {
  getOutboxSendOperations,
  retryOutboxOperation,
  type PendingOperation,
} from "@/services/db/pendingOperations";
import { triggerQueueFlush } from "@/services/queue/queueProcessor";
import { parseOutboxSendPreview } from "@/utils/outboxSendPreview";
import { EmptyState } from "@/components/ui/EmptyState";
import { GenericEmptyIllustration } from "@/components/ui/illustrations";
import { restoreCompose } from "@/services/composer/composeSendOrchestrator";
import type { ComposeSendRestore } from "@/stores/sendStatusStore";
import type { ComposerMode } from "@/stores/composerStore";

export type OutboxDisplayStatus = "pending" | "sending" | "failed";

function mapOutboxStatus(op: PendingOperation): OutboxDisplayStatus {
  if (op.status === "executing") return "sending";
  if (op.status === "failed") return "failed";
  if (op.status === "queued") return "pending";
  return "pending";
}

function statusLabel(status: OutboxDisplayStatus): string {
  switch (status) {
    case "pending":
      return "Ожидает отправки";
    case "sending":
      return "Отправка…";
    case "failed":
      return "Не удалось отправить";
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

export function OutboxList() {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const pendingOpsCount = useUIStore((s) => s.pendingOpsCount);
  const [items, setItems] = useState<PendingOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeAccountId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const ops = await getOutboxSendOperations(activeAccountId);
      // Dedupe by id (and by resource_id) in case of legacy duplicates
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

  const handleOpen = useCallback(
    async (op: PendingOperation) => {
      if (!activeAccountId) return;
      if (op.status === "executing") return;
      const restore = parseRestoreFromParams(op.params);
      if (!restore) {
        console.warn("[OutboxList] no restore payload for", op.id);
        return;
      }
      await restoreCompose(restore, activeAccountId);
    },
    [activeAccountId],
  );

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
        const canRetry = displayStatus === "failed";
        const canOpen = displayStatus !== "sending";
        return (
          <li key={op.id} className="px-4 py-3 hover:bg-bg-hover transition-colors">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0 text-accent">
                {displayStatus === "sending" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : displayStatus === "failed" ? (
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
                        : displayStatus === "sending"
                          ? "bg-accent/15 text-accent"
                          : "bg-bg-tertiary text-text-secondary"
                    }`}
                  >
                    {statusLabel(displayStatus)}
                  </span>
                </div>
                <p className="text-xs text-text-secondary truncate mt-0.5">
                  {preview.recipient}
                </p>
                <p className="text-xs text-text-tertiary mt-1">
                  {formatOutboxDate(op.created_at)}
                </p>
                {op.error_message && displayStatus === "pending" && (
                  <p className="text-xs text-text-tertiary mt-1 break-words">
                    Последняя попытка: {op.error_message}
                  </p>
                )}
                {op.error_message && displayStatus === "failed" && (
                  <p className="text-xs text-danger mt-1 break-words">
                    {op.error_message}
                  </p>
                )}
                {canOpen && (
                  <p className="text-[0.625rem] text-text-tertiary mt-1">
                    Нажмите, чтобы открыть
                  </p>
                )}
              </button>
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
            </div>
          </li>
        );
      })}
    </ul>
  );
}
