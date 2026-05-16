import { createBackgroundChecker, type BackgroundChecker } from "../backgroundCheckers";
import { useUIStore } from "@/stores/uiStore";
import {
  getPendingOperations,
  updateOperationStatus,
  deleteOperation,
  incrementRetry,
  getPendingOpsCount,
  compactQueue,
} from "../db/pendingOperations";
import { executeQueuedAction } from "../emailActions";
import { classifyError } from "@/utils/networkErrors";
import { triggerSync } from "../gmail/syncManager";

const BATCH_SIZE = 50;

let checker: BackgroundChecker | null = null;

function emitOutboxChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("velo-outbox-changed"));
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
      await executeQueuedAction(op.account_id, op.operation_type, params);

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

      if (classified.isRetryable) {
        await updateOperationStatus(op.id, "pending", classified.message);
        await incrementRetry(op.id);
      } else {
        await updateOperationStatus(op.id, "failed", classified.message);
      }
      emitOutboxChanged();
    }
  }

  await updatePendingCount();
  emitOutboxChanged();
}

async function updatePendingCount(): Promise<void> {
  const count = await getPendingOpsCount();
  useUIStore.getState().setPendingOpsCount(count);
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
