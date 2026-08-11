import { listen, emit } from "@tauri-apps/api/event";
import {
  useSendStatusStore,
  type ComposeSendRestore,
  type ActiveComposeSend,
  type ComposeSendPhase,
} from "@/stores/sendStatusStore";
import { sendEmail, archiveThread, deleteDraft as deleteDraftAction } from "@/services/emailActions";
import { notifySendEmailOutcome } from "@/utils/handleSendEmailResult";
import { showSendFeedback } from "@/utils/sendFeedbackToast";
import { upsertContact } from "@/services/db/contacts";
import {
  enqueueQueuedComposeSend,
  deleteOperation,
  updateOperationStatus,
} from "@/services/db/pendingOperations";
import { openComposeWindow } from "@/utils/openComposeWindow";
import { isTauriRuntime } from "@/utils/openThreadWindow";
import { useUIStore } from "@/stores/uiStore";
import { startAutoSave } from "@/services/composer/draftAutoSave";

export const COMPOSE_SEND_REQUESTED_EVENT = "office360-compose-send-requested";

export interface ComposeSendRequestPayload {
  requestId: string;
  accountId: string;
  rawBase64Url: string;
  threadId?: string;
  draftId?: string | null;
  restore: ComposeSendRestore;
  recipientEmails: string[];
  undoDelayMs: number;
}

export interface SendMessageProviderResult {
  id?: string;
  smtpAccepted?: boolean;
  appendedToSent?: boolean;
  localPersisted?: boolean;
}

let undoTimer: ReturnType<typeof setTimeout> | null = null;
const scheduledRequestIds = new Set<string>();

function emitOutboxChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("velo-outbox-changed"));
  }
}

function clearUndoTimer(): void {
  if (undoTimer) {
    clearTimeout(undoTimer);
    undoTimer = null;
  }
}

function isSendProviderResult(data: unknown): data is SendMessageProviderResult {
  return typeof data === "object" && data !== null;
}

export async function restoreCompose(
  restore: ComposeSendRestore,
  accountId: string,
): Promise<void> {
  await openComposeWindow({
    mode: restore.mode,
    to: restore.to,
    cc: restore.cc,
    bcc: restore.bcc,
    subject: restore.subject,
    bodyHtml: restore.bodyHtml,
    threadId: restore.threadId,
    inReplyToMessageId: restore.inReplyToMessageId,
    draftId: restore.draftId,
    fromEmail: restore.fromEmail,
  });
  startAutoSave(accountId);
}

async function executeSend(active: ActiveComposeSend): Promise<void> {
  const store = useSendStatusStore.getState();
  store.patchActive({ phase: "sending" as ComposeSendPhase });
  store.setUndoVisible(false);

  if (active.outboxOpId) {
    try {
      await updateOperationStatus(active.outboxOpId, "executing");
      emitOutboxChanged();
    } catch {
      /* ignore */
    }
  }

  try {
    console.info("[ComposeSend]", {
      requestId: active.requestId,
      stage: "sending",
      accountId: active.accountId,
    });

    showSendFeedback({
      title: "Отправка письма…",
      tone: "info",
    });

    const result = await sendEmail(
      active.accountId,
      active.rawBase64Url,
      active.threadId,
    );
    const outcome = notifySendEmailOutcome(result);

    if (outcome === "failed") {
      if (active.outboxOpId) {
        try {
          await updateOperationStatus(
            active.outboxOpId,
            "failed",
            result.error ?? "Send failed",
          );
          emitOutboxChanged();
        } catch {
          /* ignore */
        }
      }

      store.patchActive({
        phase: "failed",
        errorMessage: result.error ?? "Не удалось отправить письмо",
      });

      console.info("[ComposeSend]", {
        requestId: active.requestId,
        stage: "failed",
        outcome,
      });

      await restoreCompose(active.restore, active.accountId);
      store.clear();
      scheduledRequestIds.delete(active.requestId);
      return;
    }

    if (outcome === "queued") {
      if (active.outboxOpId) {
        try {
          await updateOperationStatus(active.outboxOpId, "pending");
          emitOutboxChanged();
        } catch {
          /* ignore */
        }
      }
      console.info("[ComposeSend]", {
        requestId: active.requestId,
        stage: "queued_offline",
      });
      store.clear();
      return;
    }

    // SMTP accepted path
    store.patchActive({ phase: "smtp_accepted" as ComposeSendPhase });
    const providerData = isSendProviderResult(result.data) ? result.data : {};
    const isImapSendResult =
      typeof providerData.localPersisted === "boolean" ||
      typeof providerData.appendedToSent === "boolean" ||
      providerData.smtpAccepted === true;
    const localPersisted = providerData.localPersisted === true;

    console.info("[ComposeSend]", {
      requestId: active.requestId,
      stage: "smtp_accepted",
      appendedToSent: providerData.appendedToSent === true,
      localPersisted,
      messageId: providerData.id ?? null,
    });

    if (isImapSendResult && !localPersisted) {
      if (active.outboxOpId) {
        try {
          await updateOperationStatus(
            active.outboxOpId,
            "failed",
            "SMTP accepted but Sent local copy missing",
          );
          emitOutboxChanged();
        } catch {
          /* ignore */
        }
      }
      showSendFeedback({
        title: "Письмо принято сервером",
        detail:
          "Не удалось сохранить копию в «Отправленных». Откройте из «Исходящих» или повторите синхронизацию.",
        tone: "error",
      });
      store.patchActive({ phase: "failed" });
      store.clear();
      scheduledRequestIds.delete(active.requestId);
      return;
    }

    store.patchActive({ phase: "sent_reconciling" as ComposeSendPhase });
    showSendFeedback({
      title: "Письмо отправлено. Обновляем «Отправленные»…",
      tone: "info",
    });

    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("velo-sync-done"));
    }

    if (active.draftId) {
      try {
        await deleteDraftAction(active.accountId, active.draftId);
      } catch {
        /* ignore */
      }
    }

    if (useUIStore.getState().sendAndArchive && active.threadId) {
      try {
        await archiveThread(active.accountId, active.threadId, []);
      } catch {
        /* ignore */
      }
    }

    for (const addr of active.recipientEmails) {
      try {
        await upsertContact(addr, null);
      } catch {
        /* ignore */
      }
    }

    // Outbox cleanup only after durable local Sent.
    if (active.outboxOpId) {
      let cleanupError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await deleteOperation(active.outboxOpId);
          cleanupError = null;
          break;
        } catch (err) {
          cleanupError = err;
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
          }
        }
      }
      emitOutboxChanged();
      if (cleanupError) {
        console.error("[ComposeSend] Failed to remove delivered Outbox operation:", cleanupError);
      }
    }

    store.patchActive({ phase: "sent" });
    console.info("[ComposeSend]", {
      requestId: active.requestId,
      stage: "sent",
    });

    showSendFeedback({
      title: "Письмо отправлено",
      tone: "info",
    });

    store.clear();
    scheduledRequestIds.delete(active.requestId);
  } catch (err) {
    console.error("[ComposeSend] execute failed:", err);
    notifySendEmailOutcome({
      success: false,
      error: "Не удалось отправить письмо. Повторите попытку.",
    });

    if (active.outboxOpId) {
      try {
        await updateOperationStatus(
          active.outboxOpId,
          "failed",
          err instanceof Error ? err.message : "Send failed",
        );
        emitOutboxChanged();
      } catch {
        /* ignore */
      }
    }

    store.patchActive({ phase: "failed" });
    await restoreCompose(active.restore, active.accountId);
    store.clear();
    scheduledRequestIds.delete(active.requestId);
  }
}

/**
 * Schedule durable undo → send on the main shell (survives compose window close).
 */
export async function scheduleComposeSend(
  payload: ComposeSendRequestPayload,
): Promise<void> {
  const existingActive = useSendStatusStore.getState().active;
  if (existingActive?.requestId === payload.requestId) {
    console.info("[ComposeSend]", {
      requestId: payload.requestId,
      stage: "dedupe_active",
    });
    return;
  }
  if (scheduledRequestIds.has(payload.requestId)) {
    console.info("[ComposeSend]", {
      requestId: payload.requestId,
      stage: "dedupe_scheduled",
    });
    return;
  }
  scheduledRequestIds.add(payload.requestId);

  clearUndoTimer();

  let outboxOpId: string | null = null;
  try {
    outboxOpId = await enqueueQueuedComposeSend(
      payload.accountId,
      payload.requestId,
      {
        rawBase64Url: payload.rawBase64Url,
        threadId: payload.threadId,
        holdForUndo: true,
        restore: payload.restore,
        requestId: payload.requestId,
        to: payload.restore.to.join(", "),
        subject: payload.restore.subject,
      },
    );
    emitOutboxChanged();
  } catch (err) {
    console.warn("[ComposeSend] outbox enqueue failed:", err);
    scheduledRequestIds.delete(payload.requestId);
  }

  const active: ActiveComposeSend = {
    requestId: payload.requestId,
    accountId: payload.accountId,
    rawBase64Url: payload.rawBase64Url,
    threadId: payload.threadId,
    draftId: payload.draftId,
    restore: payload.restore,
    recipientEmails: payload.recipientEmails,
    undoDelayMs: payload.undoDelayMs,
    outboxOpId,
    phase: "queued",
    errorMessage: null,
  };

  useSendStatusStore.getState().setActive(active);
  useSendStatusStore.getState().setUndoVisible(true);

  console.info("[ComposeSend]", {
    requestId: payload.requestId,
    stage: "queued",
    undoDelayMs: payload.undoDelayMs,
    outboxOpId,
  });

  const delay = Math.max(0, payload.undoDelayMs);
  if (delay === 0) {
    await executeSend(active);
    return;
  }

  undoTimer = setTimeout(() => {
    undoTimer = null;
    const current = useSendStatusStore.getState().active;
    if (!current || current.requestId !== payload.requestId) return;
    void executeSend(current);
  }, delay);
}

export async function cancelQueuedComposeSend(): Promise<void> {
  clearUndoTimer();
  const active = useSendStatusStore.getState().active;
  if (!active) {
    useSendStatusStore.getState().clear();
    return;
  }

  scheduledRequestIds.delete(active.requestId);

  if (active.outboxOpId) {
    try {
      await deleteOperation(active.outboxOpId);
      emitOutboxChanged();
    } catch {
      /* ignore */
    }
  }

  console.info("[ComposeSend]", {
    requestId: active.requestId,
    stage: "cancelled",
  });

  await restoreCompose(active.restore, active.accountId);
  useSendStatusStore.getState().clear();
}

/**
 * From composer: hand off send to main shell (via Tauri event if standalone).
 */
export async function requestComposeSend(
  payload: Omit<ComposeSendRequestPayload, "requestId"> & { requestId?: string },
): Promise<string> {
  const requestId = payload.requestId ?? crypto.randomUUID();
  const full: ComposeSendRequestPayload = { ...payload, requestId };

  if (isTauriRuntime()) {
    const standalone =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("compose");

    if (standalone) {
      await emit(COMPOSE_SEND_REQUESTED_EVENT, full);
      console.info("[ComposeSend]", {
        requestId,
        stage: "emitted_to_main",
      });
      return requestId;
    }
  }

  await scheduleComposeSend(full);
  return requestId;
}

/** Install once in main App (not in compose WebView). Safe under React StrictMode. */
export function installComposeSendListener(): () => void {
  let cancelled = false;
  let unlisten: (() => void) | undefined;

  void (async () => {
    try {
      const fn = await listen<ComposeSendRequestPayload>(
        COMPOSE_SEND_REQUESTED_EVENT,
        (event) => {
          const payload = event.payload;
          if (!payload?.requestId || !payload.accountId || !payload.rawBase64Url) return;
          void scheduleComposeSend(payload);
        },
      );
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    } catch (err) {
      console.warn("[ComposeSend] listener install failed:", err);
    }
  })();

  return () => {
    cancelled = true;
    unlisten?.();
    clearUndoTimer();
  };
}

/** Test helper */
export function __resetComposeSendDedupeForTests(): void {
  scheduledRequestIds.clear();
  clearUndoTimer();
}
