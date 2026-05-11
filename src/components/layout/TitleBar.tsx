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
    const appWindow = getCurrentWindow();
    appWindow.isMaximized().then(setMaximized);

    // Listen for resize events to track maximize state
    let unlisten: (() => void) | undefined;
    appWindow.onResized(() => {
      appWindow.isMaximized().then(setMaximized);
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);

  const handleMinimize = () => getCurrentWindow().minimize();
  const handleMaximize = () => getCurrentWindow().toggleMaximize();
  const handleClose = () => getCurrentWindow().close();

  return (
    <div
      className="relative z-50 grid h-9 shrink-0 grid-cols-[minmax(160px,1fr)_minmax(320px,520px)_minmax(160px,1fr)] items-center gap-3 border-b border-border-primary bg-sidebar-bg px-2 select-none"
    >
      {/* App title — left side (extra padding on macOS for traffic light buttons) */}
      <div data-tauri-drag-region className={`flex h-full items-center gap-2 ${isMac ? "pl-20" : "pl-2"}`}>
        <img data-tauri-drag-region src={appIcon} alt={APP_NAME_EN} className="h-5 w-5 rounded" />
        <span data-tauri-drag-region className="text-xs font-semibold text-sidebar-text tracking-wide">
          {APP_NAME_EN}
        </span>
      </div>

      <div className="flex min-w-0 justify-center">
        <AskInbox />
      </div>

      {/* Window controls — right side (hidden on macOS, uses native traffic lights) */}
      <div className="flex h-full items-center justify-end">
        {!isMac && (
          <div className="-mr-2 flex h-full items-center">
            <button
              onClick={handleMinimize}
              className="h-full px-3.5 flex items-center justify-center text-sidebar-text/70 hover:bg-sidebar-hover transition-colors"
              title="Minimize"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={handleMaximize}
              className="h-full px-3.5 flex items-center justify-center text-sidebar-text/70 hover:bg-sidebar-hover transition-colors"
              title={maximized ? "Restore" : "Maximize"}
            >
              {maximized ? <Copy size={12} /> : <Square size={12} />}
            </button>
            <button
              onClick={handleClose}
              className="h-full px-3.5 flex items-center justify-center text-sidebar-text/70 hover:bg-danger hover:text-white transition-colors"
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
