import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from "lucide-react";

export type BannerTone = "info" | "warning" | "danger" | "success";

interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons or links; rendered under the message. */
  actions?: ReactNode;
  icon?: ReactNode;
  /** Slot rendered at the trailing edge, before the dismiss control. */
  trailing?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
  role?: "status" | "alert";
}

const TONES: Record<BannerTone, { box: string; icon: string; Icon: typeof Info }> = {
  info: {
    box: "bg-info-surface border-info-border",
    icon: "text-info-text",
    Icon: Info,
  },
  warning: {
    box: "bg-warning-surface border-warning-border",
    icon: "text-warning-text",
    Icon: AlertTriangle,
  },
  danger: {
    box: "bg-danger-surface border-danger-border",
    icon: "text-danger-text",
    Icon: XCircle,
  },
  success: {
    box: "bg-success-surface border-success-border",
    icon: "text-success-text",
    Icon: CheckCircle2,
  },
};

/**
 * Inline status message: offline, sync failure, auth expiry, security warnings.
 *
 * Every tone is a tinted surface with dark text, never a saturated fill with
 * white text on it. The old offline banner was `bg-warning/90 text-white`,
 * which measures 3.19:1 — below the 4.5:1 AA floor for body-size text.
 */
export function Banner({
  tone = "info",
  title,
  children,
  actions,
  icon,
  trailing,
  onDismiss,
  dismissLabel = "Закрыть",
  className = "",
  role = "status",
}: BannerProps) {
  const { box, icon: iconColor, Icon } = TONES[tone];

  return (
    <div
      role={role}
      className={`flex items-start gap-2.5 rounded-card border px-3 py-2.5 ${box} ${className}`}
    >
      <span className={`mt-px shrink-0 ${iconColor}`} aria-hidden>
        {icon ?? <Icon size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="text-meta font-semibold text-ink-primary">{title}</p>}
        {children && (
          <div className={`text-caption text-ink-secondary ${title ? "mt-0.5" : ""}`}>
            {children}
          </div>
        )}
        {actions && <div className="mt-2 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {trailing}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="focus-ring -mr-0.5 shrink-0 rounded-control p-1 text-ink-tertiary t-fast hover:text-ink-primary"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
