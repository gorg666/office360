import { useCallback, useEffect, useRef, useState } from "react";
import { CSSTransition } from "react-transition-group";
import {
  SEND_FEEDBACK_EVENT,
  type SendFeedbackPayload,
} from "@/utils/sendFeedbackToast";

const AUTO_DISMISS_MS = 7000;

export function SendFeedbackToast() {
  const [payload, setPayload] = useState<SendFeedbackPayload | null>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setPayload(null);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SendFeedbackPayload>).detail;
      if (!detail?.title) return;
      setPayload(detail);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS);
    };

    window.addEventListener(SEND_FEEDBACK_EVENT, handler);
    return () => {
      window.removeEventListener(SEND_FEEDBACK_EVENT, handler);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [dismiss]);

  const isError = payload?.tone === "error";

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
        className={`fixed bottom-20 right-4 z-[60] max-w-sm rounded-lg shadow-lg overflow-hidden ${
          isError ? "bg-danger/95 text-white" : "glass-panel"
        }`}
      >
        {payload ? (
          <div className="px-4 py-3 space-y-1">
            <p className={`text-sm font-medium ${isError ? "" : "text-text-primary"}`}>
              {payload.title}
            </p>
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
            <button
              type="button"
              onClick={dismiss}
              className={`text-xs underline mt-1 ${
                isError ? "text-white/90 hover:text-white" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </CSSTransition>
  );
}
