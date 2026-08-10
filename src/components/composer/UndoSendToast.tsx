import { useRef } from "react";
import { CSSTransition } from "react-transition-group";
import { useSendStatusStore } from "@/stores/sendStatusStore";
import { cancelQueuedComposeSend } from "@/services/composer/composeSendOrchestrator";

export function UndoSendToast() {
  const undoVisible = useSendStatusStore((s) => s.undoVisible);
  const undoDelayMs = useSendStatusStore((s) => s.active?.undoDelayMs ?? 5000);
  const toastRef = useRef<HTMLDivElement>(null);
  const delaySeconds = Math.max(1, Math.round(undoDelayMs / 1000));

  const handleUndo = () => {
    void cancelQueuedComposeSend();
  };

  return (
    <CSSTransition nodeRef={toastRef} in={undoVisible} timeout={200} classNames="toast" unmountOnExit>
      <div ref={toastRef} className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-text-primary text-bg-primary rounded-lg shadow-lg overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-3">
          <span className="text-sm">Отправка письма…</span>
          <button
            type="button"
            onClick={handleUndo}
            className="text-sm font-medium text-accent hover:text-accent-hover underline"
          >
            Отменить
          </button>
        </div>
        <div className="h-0.5 bg-white/20">
          <div
            className="h-full bg-accent rounded-full"
            style={{ animation: `countdownBar ${delaySeconds}s linear forwards` }}
          />
        </div>
      </div>
    </CSSTransition>
  );
}
