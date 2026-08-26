import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";
import appIcon from "@/assets/logo_office_360.png";
import { APP_NAME_EN } from "@/i18n";
import { AskInbox } from "@/components/search/AskInbox";

const isMac = navigator.userAgent.includes("Macintosh");

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const appWindow = getCurrentWindow();
        if (cancelled) return;
        setMaximized(await appWindow.isMaximized());
        unlisten = await appWindow.onResized(() => {
          appWindow.isMaximized().then(setMaximized);
        });
      } catch {
        // Browser preview — no Tauri window API
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const handleMinimize = () => {
    void getCurrentWindow().minimize().catch(() => {});
  };
  const handleMaximize = () => {
    void getCurrentWindow().toggleMaximize().catch(() => {});
  };
  const handleClose = () => {
    void getCurrentWindow().close().catch(() => {});
  };

  return (
    <div className="material-subtle relative z-sticky h-10 shrink-0 border-b border-separator select-none">
      {/* Full-width drag hit target; interactive children opt in with pointer-events-auto */}
      <div
        data-tauri-drag-region
        className="absolute inset-0 z-0"
        aria-hidden="true"
      />

      <div className="relative z-10 grid h-full w-full grid-cols-[minmax(160px,1fr)_minmax(320px,520px)_minmax(160px,1fr)] items-center gap-3 px-2 pointer-events-none">
        <div className={`flex h-full items-center gap-2 ${isMac ? "pl-20" : "pl-2"}`}>
          {/* the mark is already a squircle — an extra `rounded` double-rounds it at 20px */}
          <img src={appIcon} alt={APP_NAME_EN} className="h-5 w-5" />
          <span className="text-control font-semibold text-ink-primary">
            {APP_NAME_EN}
          </span>
        </div>

        <div className="flex min-w-0 justify-center">
          <div className="pointer-events-auto w-full max-w-[520px]">
            <AskInbox />
          </div>
        </div>

        <div className="flex h-full items-center justify-end">
          {!isMac && (
            <div className="-mr-2 flex h-full items-center pointer-events-auto">
              <button
                type="button"
                onClick={handleMinimize}
                className="focus-ring-inset flex h-full items-center justify-center px-3.5 text-ink-secondary t-fast hover:bg-brand-tint-1 hover:text-ink-primary"
                title="Minimize"
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                onClick={handleMaximize}
                className="focus-ring-inset flex h-full items-center justify-center px-3.5 text-ink-secondary t-fast hover:bg-brand-tint-1 hover:text-ink-primary"
                title={maximized ? "Restore" : "Maximize"}
              >
                {maximized ? <Copy size={12} /> : <Square size={12} />}
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="focus-ring-inset flex h-full items-center justify-center px-3.5 text-ink-secondary t-fast hover:bg-danger-solid hover:text-white"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
