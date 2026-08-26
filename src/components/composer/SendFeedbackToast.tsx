import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CSSTransition } from "react-transition-group";
import {
  SEND_FEEDBACK_EVENT,
  type SendFeedbackPayload,
} from "@/utils/sendFeedbackToast";
import { useSendStatusStore } from "@/stores/sendStatusStore";
import { cancelQueuedComposeSend } from "@/services/composer/composeSendOrchestrator";

const AUTO_DISMISS_MS = 7000;

type DisplayPayload = SendFeedbackPayload & { showUndo?: boolean };

function payloadFromActivePhase(
  phase: string | undefined,
  undoVisible: boolean,
  _undoDelayMs: number,
  errorMessage: string | null,
): DisplayPayload | null {
  if (!phase || phase === "idle") return null;

  if (phase === "queued" && undoVisible) {
    return {
      title: "Отправка письма…",
      tone: "info",
      showUndo: true,
    };
  }

  if (phase === "queued" || phase === "sending" || phase === "smtp_accepted") {
    return { title: "Отправка письма…", tone: "info" };
  }

  if (phase === "sent_reconciling") {
    return {
      title: "Письмо отправлено. Обновляем «Отправленные»…",
      tone: "info",
    };
  }

  if (phase === "sent") {
    return { title: "Письмо отправлено", tone: "info" };
  }

  if (phase === "failed") {
    return {
      title: "Не удалось отправить",
      detail: errorMessage?.trim() || "Не удалось отправить письмо. Повторите попытку.",
      footnote: "Черновик сохранён — можно повторить отправку.",
      tone: "error",
    };
  }

  return null;
}

/**
 * Single global send-status toast for the main shell.
 * Store-driven phases own the UI while a compose send is active;
 * CustomEvent feedback is only for outcomes outside / after the active send.
 */
export function SendFeedbackToast() {
  const active = useSendStatusStore((s) => s.active);
  const undoVisible = useSendStatusStore((s) => s.undoVisible);
  const [eventPayload, setEventPayload] = useState<SendFeedbackPayload | null>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storePayload = useMemo(
    () =>
      payloadFromActivePhase(
        active?.phase,
        undoVisible,
        active?.undoDelayMs ?? 5000,
        active?.errorMessage ?? null,
      ),
    [active?.phase, active?.undoDelayMs, active?.errorMessage, undoVisible],
  );

  const dismissEvent = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setEventPayload(null);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SendFeedbackPayload>).detail;
      if (!detail?.title) return;
      // While an orchestrated send is active, phases own the toast — ignore
      // duplicate event titles so we never mount a second parallel notification.
      if (useSendStatusStore.getState().active) return;
      setEventPayload(detail);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(dismissEvent, AUTO_DISMISS_MS);
    };

    window.addEventListener(SEND_FEEDBACK_EVENT, handler);
    return () => {
      window.removeEventListener(SEND_FEEDBACK_EVENT, handler);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [dismissEvent]);

  // After active send ends on "sent", keep a brief terminal toast via event channel
  // is handled by orchestrator showSendFeedback only when active is cleared.
  // Auto-dismiss store "sent" by clearing is orchestrator's job; show until clear.

  const payload: DisplayPayload | null = storePayload ?? eventPayload;
  const undoDelayMs = active?.undoDelayMs ?? 5000;
  const delaySeconds = Math.max(1, Math.round(undoDelayMs / 1000));
  const isError = payload?.tone === "error";
  const showUndo = Boolean(payload?.showUndo);

  const handleUndo = () => {
    void cancelQueuedComposeSend();
  };

  const handleDismiss = () => {
    if (storePayload) return; // active send status is not manually dismissible mid-flight
    dismissEvent();
  };

  return (
    <CSSTransition
      nodeRef={toastRef}
      in={payload !== null}
      timeout={200}
      classNames="toast"
      unmountOnExit
    >
      <div
        ref={toastRef}
        data-testid="send-feedback-toast"
        data-send-toast="global"
        className={`fixed bottom-20 right-4 z-[60] max-w-sm rounded-lg shadow-lg overflow-hidden ${
          isError ? "bg-danger-surface text-danger-text border border-danger-border" : "material-elevated"
        }`}
      >
        {payload ? (
          <div className="px-4 py-3 space-y-1">
            <div className="flex items-center gap-3">
              <p className={`text-sm font-medium ${isError ? "" : "text-text-primary"}`}>
                {payload.title}
              </p>
              {showUndo ? (
                <button
                  type="button"
                  onClick={handleUndo}
                  className="text-sm font-medium text-accent hover:text-accent-hover underline shrink-0"
                >
                  Отменить
                </button>
              ) : null}
            </div>
            {payload.detail ? (
              <p className={`text-xs ${isError ? "text-white/90" : "text-text-secondary"}`}>
                {payload.detail}
              </p>
            ) : null}
            {payload.footnote ? (
              <p className={`text-xs ${isError ? "text-white/80" : "text-text-tertiary"}`}>
                {payload.footnote}
              </p>
            ) : null}
            {!showUndo && !storePayload ? (
              <button
                type="button"
                onClick={handleDismiss}
                className={`text-xs underline mt-1 ${
                  isError
                    ? "text-white/90 hover:text-white"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                Закрыть
              </button>
            ) : null}
            {showUndo ? (
              <div className="h-0.5 bg-black/10 mt-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full"
                  style={{ animation: `countdownBar ${delaySeconds}s linear forwards` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </CSSTransition>
  );
}
