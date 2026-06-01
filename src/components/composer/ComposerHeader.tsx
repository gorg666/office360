import { Maximize2, Minimize2, ExternalLink } from "lucide-react";
import { isComposeStandaloneWindow } from "@/utils/openComposeWindow";

interface ComposerHeaderProps {
  modeLabel: string;
  isFullpage: boolean;
  onToggleViewMode: () => void;
  onPopOut: () => void;
  onCloseEmbedded: () => void;
}

export function ComposerHeader({
  modeLabel,
  isFullpage,
  onToggleViewMode,
  onPopOut,
  onCloseEmbedded,
}: ComposerHeaderProps) {
  const isStandalone = isComposeStandaloneWindow();

  return (
    <div
      className={`relative flex shrink-0 items-center justify-between border-b border-border-primary bg-bg-secondary px-4 py-2.5 select-none ${
        isStandalone ? "rounded-none" : "rounded-t-lg"
      }`}
    >
      <span className="relative z-10 text-sm font-medium text-text-primary pointer-events-none">
        {modeLabel}
      </span>
      <div className="relative z-10 flex items-center gap-1">
        {!isStandalone ? (
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
              className="p-1 text-lg leading-none text-text-tertiary hover:text-text-primary"
              title="Закрыть"
            >
              ×
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
