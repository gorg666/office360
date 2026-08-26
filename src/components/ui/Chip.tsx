import type { ReactNode } from "react";
import { X } from "lucide-react";

export type ChipTone = "neutral" | "brand" | "danger" | "warning" | "success" | "info";

interface ChipProps {
  children: ReactNode;
  tone?: ChipTone;
  /** Leading element — an avatar, a colour dot, an icon. */
  leading?: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  title?: string;
  className?: string;
}

const TONES: Record<ChipTone, string> = {
  neutral: "bg-surface-sunken text-ink-secondary",
  brand: "bg-brand-tint-1 text-brand-text",
  danger: "bg-danger-surface text-danger-text",
  warning: "bg-warning-surface text-warning-text",
  success: "bg-success-surface text-success-text",
  info: "bg-info-surface text-info-text",
};

/**
 * Compact pill: recipient chips, counts, labels, "+N more".
 *
 * The remove affordance only appears on hover or keyboard focus, so a row of
 * chips stays quiet until it is actually being edited.
 */
export function Chip({
  children,
  tone = "neutral",
  leading,
  onRemove,
  removeLabel = "Удалить",
  title,
  className = "",
}: ChipProps) {
  return (
    <span
      title={title}
      className={`group/chip inline-flex max-w-full items-center gap-1 rounded-full
        py-0.5 pl-1.5 text-caption font-medium ${onRemove ? "pr-0.5" : "pr-2"}
        ${TONES[tone]} ${className}`}
    >
      {leading}
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="focus-ring shrink-0 rounded-full p-0.5 opacity-0 t-fast
            hover:bg-black/10 group-hover/chip:opacity-70 focus-visible:opacity-100
            hover:opacity-100 dark:hover:bg-white/15"
        >
          <X size={10} aria-hidden />
        </button>
      )}
    </span>
  );
}
