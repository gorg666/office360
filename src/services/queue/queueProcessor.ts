import { createBackgroundChecker, type BackgroundChecker } from "../backgroundCheckers";
import { useUIStore } from "@/stores/uiStore";
import {
  getPendingOperations,
  updateOperationStatus,
  deleteOperation,
  incrementRetry,
  getQueueSummary,
  compactQueue,
  blockOperation,
  failOperation,
  type QueueUserAction,
} from "../db/pendingOperations";
import { executeQueuedAction } from "../emailActions";
import { executeCalendarQueuedAction } from "../calendar/invitations";
import { updateCalendarItipAction } from "../db/calendarItipActions";
import { updateInvitationQueueStatus } from "../db/calendarInvitations";
import { classifyError } from "@/utils/networkErrors";
import { triggerSync } from "../gmail/syncManager";
import { upsertAccountDiagnostic } from "../db/accountDiagnostics";
import { createConnectionDiagnostic } from "../diagnostics";

const BATCH_SIZE = 50;

let checker: BackgroundChecker | null = null;

function emitOutboxChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("velo-outbox-changed"));
    window.dispatchEvent(new Event("velo-queue-changed"));
  }
}

/** Tauri/desktop may miss `window` `online` — reconcile with navigator.onLine before flush. */
function reconcileOnlineState(): boolean {
  if (typeof navigator === "undefined") {
    return useUIStore.getState().isOnline;
  }
  const browserOnline = navigator.onLine;
  const { isOnline, setOnline } = useUIStore.getState();
  if (browserOnline && !isOnline) {
    setOnline(true);
  } else if (!browserOnline && isOnline) {
    setOnline(false);
  }
  return browserOnline;
}

async function processQueue(): Promise<void> {
  if (!reconcileOnlineState()) return;

  // Compact first to eliminate redundant ops
  await compactQueue();

  // Get pending operations
  const ops = await getPendingOperations(undefined, BATCH_SIZE);
  if (ops.length === 0) {
    await updatePendingCount();
    emitOutboxChanged();
    return;
  }

  for (const op of ops) {
    try {
      await updateOperationStatus(op.id, "executing");
      emitOutboxChanged();

      const params = JSON.parse(op.params) as Record<string, unknown>;
      const itipActionKey = typeof params.itipActionKey === "string" ? params.itipActionKey : null;
      const itipInvitationId = typeof params.itipInvitationId === "string" ? params.itipInvitationId : null;
      if (itipActionKey) {
        await updateCalendarItipAction({ actionKey: itipActionKey, deliveryStatus: "delivering" });
      }
      if (op.operation_type === "calendarRsvp") {
        const result = await executeCalendarQueuedAction(op.account_id, op.operation_type, params);
        if (result.status === "unsupported") {
          await blockOperation(op.id, result.message, {
            diagnosticCode: "calendar_write_unsupported",
            userAction: "export_debug",
            errorMessage: result.message,
          });
          emitOutboxChanged();
          continue;
        }
        if (result.status !== "success") {
          throw new Error(result.message);
        }
      } else {
        await executeQueuedAction(op.account_id, op.operation_type, params);
      }

      if (itipActionKey) {
        const deliveredAt = Math.floor(Date.now() / 1000);
        await updateCalendarItipAction({
          actionKey: itipActionKey,
          deliveryStatus: "delivered",
          deliveredAt,
          failureCode: null,
        });
        if (itipInvitationId) await updateInvitationQueueStatus(itipInvitationId, "delivered");
      }

      await deleteOperation(op.id);
      emitOutboxChanged();

      if (op.operation_type === "sendMessage") {
        void triggerSync([op.account_id]).catch((err) => {
          console.warn("[QueueProcessor] post-send sync failed:", err);
        });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("velo-sync-done"));
        }
      }
    } catch (err) {
      const classified = classifyError(err);
      const diagnostic = createConnectionDiagnostic(err, {
        accountId: op.account_id,
        provider: "imap",
        layer: op.operation_type === "sendMessage" ? "smtp" : "provider",
        operation: op.operation_type,
        retryState: classified.isRetryable ? "scheduled" : "failed",
        retryCount: op.retry_count,
      });
      await upsertAccountDiagnostic(diagnostic).catch((dbErr) => {
        console.warn("[diagnostics] Failed to persist queue diagnostic:", dbErr);
      });

      if (classified.isRetryable) {
        await updateOperationStatus(op.id, "retry_scheduled", classified.message);
        await incrementRetry(op.id);
        const params = JSON.parse(op.params) as Record<string, unknown>;
        if (typeof params.itipActionKey === "string") {
          await updateCalendarItipAction({
            actionKey: params.itipActionKey,
            deliveryStatus: "retry_scheduled",
            failureCode: classified.type,
          });
        }
      } else if (
        classified.type === "auth" ||
        diagnostic.severity === "blocked" ||
        diagnostic.userAction === "reauth" ||
        diagnostic.reason === "unsupported_capability"
      ) {
        await blockOperation(op.id, diagnostic.userMessage, {
          diagnosticCode: diagnostic.debugCode,
          userAction: diagnostic.userAction as QueueUserAction,
          errorMessage: diagnostic.rawCause ?? classified.message,
        });
        const params = JSON.parse(op.params) as Record<string, unknown>;
        if (typeof params.itipActionKey === "string") {
          await updateCalendarItipAction({ actionKey: params.itipActionKey, deliveryStatus: "failed", failureCode: diagnostic.debugCode });
          if (typeof params.itipInvitationId === "string") await updateInvitationQueueStatus(params.itipInvitationId, "failed");
        }
      } else {
        await failOperation(op.id, classified.message, {
          diagnosticCode: diagnostic.debugCode,
          userAction: op.operation_type === "sendMessage" ? "edit_settings" : diagnostic.userAction,
        });
        const params = JSON.parse(op.params) as Record<string, unknown>;
        if (typeof params.itipActionKey === "string") {
          await updateCalendarItipAction({ actionKey: params.itipActionKey, deliveryStatus: "failed", failureCode: diagnostic.debugCode });
          if (typeof params.itipInvitationId === "string") await updateInvitationQueueStatus(params.itipInvitationId, "failed");
        }
      }
      emitOutboxChanged();
    }
  }

  await updatePendingCount();
  emitOutboxChanged();
}

async function updatePendingCount(): Promise<void> {
  const summary = await getQueueSummary();
  useUIStore.getState().setPendingOpsCount(summary.active);
}

export function startQueueProcessor(): void {
  if (checker) return;
  checker = createBackgroundChecker("QueueProcessor", processQueue, 30_000);
  checker.start();
}

export function stopQueueProcessor(): void {
  checker?.stop();
  checker = null;
}

/**
 * Trigger an immediate queue flush (e.g., when coming back online).
 * Returns a promise that resolves when processing completes.
 */
export async function triggerQueueFlush(): Promise<void> {
  try {
    await processQueue();
  } catch (err) {
    console.error("[QueueProcessor] flush failed:", err);
  }
}
