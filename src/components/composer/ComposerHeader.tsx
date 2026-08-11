import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2, ExternalLink, Minus, Square, Copy, X } from "lucide-react";
import { isComposeStandaloneWindow } from "@/utils/openComposeWindow";

interface ComposerHeaderProps {
  modeLabel: string;
  isFullpage: boolean;
  onToggleViewMode: () => void;
  onPopOut: () => void;
  onCloseEmbedded: () => void;
  onCloseStandalone: () => void;
}

export function ComposerHeader({
  modeLabel,
  isFullpage,
  onToggleViewMode,
  onPopOut,
  onCloseEmbedded,
  onCloseStandalone,
}: ComposerHeaderProps) {
  const isStandalone = isComposeStandaloneWindow();
  const [windowMaximized, setWindowMaximized] = useState(false);

  useEffect(() => {
    if (!isStandalone) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();
        if (cancelled) return;
        setWindowMaximized(await appWindow.isMaximized());
        unlisten = await appWindow.onResized(() => {
          appWindow.isMaximized().then(setWindowMaximized);
        });
      } catch {
        // Browser preview — no Tauri window API
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isStandalone]);

  const handleMinimizeWindow = useCallback(() => {
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().minimize())
      .catch(() => {});
  }, []);

  const handleToggleMaximizeWindow = useCallback(() => {
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize())
      .catch(() => {});
  }, []);

  return (
    <div
      className={`relative flex shrink-0 items-center justify-between border-b border-border-primary bg-bg-secondary px-4 py-2.5 select-none ${
        isStandalone ? "rounded-none" : "rounded-t-lg"
      }`}
    >
      {isStandalone ? (
        <div
          data-tauri-drag-region
          className="absolute inset-0 z-0"
          aria-hidden="true"
        />
      ) : null}
      <span className="relative z-10 text-sm font-medium text-text-primary pointer-events-none">
        {modeLabel}
      </span>
      <div className="relative z-10 flex items-center gap-1">
        {isStandalone ? (
          <>
            <button
              type="button"
              onClick={handleMinimizeWindow}
              className="flex items-center justify-center rounded p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              title="Свернуть"
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              onClick={handleToggleMaximizeWindow}
              className="flex items-center justify-center rounded p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              title={windowMaximized ? "Восстановить" : "Развернуть"}
            >
              {windowMaximized ? <Copy size={12} /> : <Square size={12} />}
            </button>
            <button
              type="button"
              onClick={onCloseStandalone}
              className="flex items-center justify-center rounded p-1.5 text-text-tertiary transition-colors hover:bg-danger hover:text-white"
              title="Закрыть"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggleViewMode}
              className="rounded p-1 text-text-tertiary transition-colors hover:text-text-primary"
              title={isFullpage ? "Свернуть" : "Развернуть"}
            >
              {isFullpage ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              type="button"
              onClick={onPopOut}
              className="rounded p-1 text-text-tertiary transition-colors hover:text-text-primary"
              title="Открыть в новом окне"
            >
              <ExternalLink size={14} />
            </button>
            <button
              type="button"
              onClick={onCloseEmbedded}
              className="p-1 text-text-tertiary hover:text-text-primary"
              title="Закрыть"
              aria-label="Закрыть"
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
