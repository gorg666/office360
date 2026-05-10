import { lazy, Suspense, useCallback, useRef, useState, type ReactNode } from "react";
import { EmailList } from "./EmailList";
import { ReadingPane } from "./ReadingPane";
import { useUIStore } from "@/stores/uiStore";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

const MessengerSideStrip = lazy(() =>
  import("@/components/messengers/MessengerSideStrip").then((m) => ({ default: m.MessengerSideStrip })),
);

const MESSENGER_ASIDE_TOTAL_KEY = "velo_mail_messenger_aside_total:v1";
/** Прежний дефолт до привязки к ширине окна — мигрируем в пропорциональный, если пользователь не менял руками. */
const LEGACY_DEFAULT_MESSENGER_ASIDE_PX = 680;
const MESSENGER_ASIDE_MIN = 560;
const MESSENGER_ASIDE_MAX = 960;
/** Верхняя граница стартовой ширины мессенджера на очень широких мониторах (область чтения остаётся основной). */
const MESSENGER_ASIDE_DEFAULT_CAP = 720;

function clampMessengerAside(n: number): number {
  return Math.min(MESSENGER_ASIDE_MAX, Math.max(MESSENGER_ASIDE_MIN, n));
}

/**
 * Доля окна под две колонки мессенджера (как на эталонном макете: широкая панель чтения, средние диалоги и чат).
 */
function computeDefaultMessengerAsideTotal(): number {
  if (typeof window === "undefined") return 600;
  const target = Math.round(window.innerWidth * 0.31);
  return clampMessengerAside(Math.min(MESSENGER_ASIDE_DEFAULT_CAP, target));
}

function loadMessengerAsideTotal(): number {
  const fallback = computeDefaultMessengerAsideTotal();
  try {
    const raw = localStorage.getItem(MESSENGER_ASIDE_TOTAL_KEY);
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallback;
    const clamped = clampMessengerAside(n);
    if (
      clamped === LEGACY_DEFAULT_MESSENGER_ASIDE_PX &&
      fallback !== LEGACY_DEFAULT_MESSENGER_ASIDE_PX
    ) {
      persistMessengerAsideTotal(fallback);
      return fallback;
    }
    return clamped;
  } catch {
    return fallback;
  }
}

function persistMessengerAsideTotal(width: number): void {
  try {
    localStorage.setItem(MESSENGER_ASIDE_TOTAL_KEY, String(clampMessengerAside(width)));
  } catch {
    // best-effort
  }
}

function ResizableEmailLayout() {
  const emailListWidth = useUIStore((s) => s.emailListWidth);
  const setEmailListWidth = useUIStore((s) => s.setEmailListWidth);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = listRef.current?.offsetWidth ?? emailListWidth;

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.min(800, Math.max(240, startWidth + delta));
      if (listRef.current) listRef.current.style.width = `${newWidth}px`;
    };

    const handleMouseUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const delta = ev.clientX - startX;
      const finalWidth = Math.min(800, Math.max(240, startWidth + delta));
      setEmailListWidth(finalWidth);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [emailListWidth, setEmailListWidth]);

  return (
    <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-row">
      <EmailList width={emailListWidth} listRef={listRef} />
      <div
        onMouseDown={handleMouseDown}
        className="w-1 cursor-col-resize bg-border-primary hover:bg-accent/50 active:bg-accent transition-colors shrink-0"
      />
      <ReadingPane />
    </div>
  );
}

function MailWithMessengerChrome({ children, messengersOpen }: { children: ReactNode; messengersOpen: boolean }) {
  const [asideTotal, setAsideTotal] = useState(loadMessengerAsideTotal);
  const asideTotalRef = useRef(asideTotal);
  asideTotalRef.current = asideTotal;

  const handleMessengerAsideMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = asideTotalRef.current;

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const next = clampMessengerAside(startW + delta);
      asideTotalRef.current = next;
      setAsideTotal(next);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      persistMessengerAsideTotal(asideTotalRef.current);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const mailColumn = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
  );

  if (!messengersOpen) return mailColumn;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {mailColumn}
      <div
        onMouseDown={handleMessengerAsideMouseDown}
        className="w-1 shrink-0 cursor-col-resize bg-border-primary transition-colors hover:bg-accent/50 active:bg-accent"
        aria-label="Ширина панели мессенджера"
        aria-orientation="vertical"
        role="separator"
      />
      <Suspense
        fallback={<div className="h-full w-2 shrink-0 animate-pulse bg-border-primary/30" aria-hidden />}
      >
        <ErrorBoundary name="MessengerSideStrip">
          <MessengerSideStrip asideTotalWidth={asideTotal} />
        </ErrorBoundary>
      </Suspense>
    </div>
  );
}

export function MailLayout() {
  const readingPanePosition = useUIStore((s) => s.readingPanePosition);
  const messengersPanelsOpen = useUIStore((s) => s.messengersPanelsOpen);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {readingPanePosition === "right" ? (
        <MailWithMessengerChrome messengersOpen={messengersPanelsOpen}>
          <ErrorBoundary name="EmailLayout">
            <ResizableEmailLayout />
          </ErrorBoundary>
        </MailWithMessengerChrome>
      ) : (
        <MailWithMessengerChrome messengersOpen={messengersPanelsOpen}>
          <div
            className={`flex min-h-0 min-w-0 flex-1 ${readingPanePosition === "bottom" ? "flex-col" : "flex-row"}`}
          >
            <ErrorBoundary name="EmailList">
              <EmailList />
            </ErrorBoundary>
            {readingPanePosition !== "hidden" && (
              <ErrorBoundary name="ReadingPane">
                <ReadingPane />
              </ErrorBoundary>
            )}
          </div>
        </MailWithMessengerChrome>
      )}
    </div>
  );
}
