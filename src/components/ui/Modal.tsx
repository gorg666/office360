import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CSSTransition } from "react-transition-group";
import { X } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
  /** Custom z-index class (default: "z-50") */
  zIndex?: string;
  /** Additional classes on the panel container */
  panelClassName?: string;
  /** Replace the default header entirely */
  renderHeader?: ReactNode;
  closeAriaLabel?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  width = "w-72",
  zIndex = "z-50",
  panelClassName,
  renderHeader,
  closeAriaLabel = "Закрыть",
}: ModalProps) {
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = () => nodeRef.current?.querySelector<HTMLElement>("[data-modal-panel]");
    requestAnimationFrame(() => {
      const first = panel()?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (first ?? panel())?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const current = panel();
      if (current) trapTab(current, event);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen, onClose]);

  return createPortal(
    <CSSTransition in={isOpen} timeout={150} classNames="modal" unmountOnExit nodeRef={nodeRef}>
      <div ref={nodeRef} className={`fixed inset-0 ${zIndex} flex items-center justify-center`} onContextMenu={(e) => e.stopPropagation()}>
        <div className="absolute inset-0 bg-black/20 glass-backdrop" onClick={onClose} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          data-modal-panel
          tabIndex={-1}
          className={`relative bg-bg-primary border border-border-primary rounded-lg glass-modal outline-none ${width}${panelClassName ? ` ${panelClassName}` : ""}`}
        >
          {renderHeader !== undefined ? (
            renderHeader
          ) : (
            <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-0.5 text-text-tertiary hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                aria-label={closeAriaLabel}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {children}
        </div>
      </div>
    </CSSTransition>,
    document.body,
  );
}

function trapTab(container: HTMLElement, event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const items = [...container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )];
  if (items.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
