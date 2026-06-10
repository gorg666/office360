import { AlertTriangle, ImageOff, Paperclip, ShieldAlert, ShieldX, X } from "lucide-react";
import type { ReactNode } from "react";
import type { SecurityWarning, SecurityWarningAction } from "@/services/security/securityWarnings";

interface SecurityWarningBannerProps {
  warning: SecurityWarning;
  onAction?: (action: SecurityWarningAction) => void;
  onDismiss?: () => void;
  trailing?: ReactNode;
  className?: string;
}

const ACTION_LABELS: Record<SecurityWarningAction, string> = {
  allow_once: "Load once",
  always_allow_sender: "Always allow sender",
  inspect: "Inspect",
  download: "Download",
  open_external: "Open externally",
  report: "Report",
  dismiss: "Dismiss",
};

export function SecurityWarningBanner({
  warning,
  onAction,
  onDismiss,
  trailing,
  className,
}: SecurityWarningBannerProps) {
  const isDanger = warning.severity === "danger";
  const isWarning = warning.severity === "warning";
  const Icon = getIcon(warning.kind, warning.severity);
  const color = isDanger ? "danger" : isWarning ? "warning" : "text-tertiary";
  const borderClass = isDanger
    ? "border-danger/30 bg-danger/10"
    : isWarning
      ? "border-warning/30 bg-warning/10"
      : "border-border-secondary bg-bg-tertiary";
  const textClass = isDanger ? "text-danger" : isWarning ? "text-warning" : "text-text-secondary";

  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${borderClass}${className ? ` ${className}` : ""}`}>
      <Icon size={16} className={`shrink-0 mt-0.5 ${isDanger ? "text-danger" : isWarning ? "text-warning" : "text-text-tertiary"}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-medium ${textClass}`}>
          {getTitle(warning)}
        </p>
        <p className="mt-0.5 text-xs text-text-secondary">
          {warning.reason}
        </p>
        <p className="mt-0.5 text-xs text-text-tertiary">
          {warning.recommendedAction}
        </p>
        {onAction && warning.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {warning.actions.filter((action) => action !== "dismiss").map((action) => (
              <button
                key={action}
                onClick={() => onAction(action)}
                className={`text-xs font-medium ${color === "danger" ? "text-danger hover:text-danger/80" : color === "warning" ? "text-warning hover:text-warning/80" : "text-accent hover:text-accent-hover"}`}
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
        )}
      </div>
      {trailing}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
          aria-label="Dismiss warning"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function getIcon(kind: SecurityWarning["kind"], severity: SecurityWarning["severity"]) {
  if (kind === "remote_content") return ImageOff;
  if (kind === "unsafe_attachment") return Paperclip;
  if (kind === "sender_auth") return ShieldX;
  if (kind === "suspicious_link" || kind === "spoofing_risk") return ShieldAlert;
  return severity === "danger" ? ShieldAlert : AlertTriangle;
}

function getTitle(warning: SecurityWarning): string {
  if (warning.kind === "remote_content") return "Remote content blocked";
  if (warning.kind === "suspicious_link") return warning.severity === "danger" ? "High-risk links detected" : "Suspicious links detected";
  if (warning.kind === "sender_auth") return "Authentication failed";
  if (warning.kind === "unsafe_attachment") return "Risky attachment";
  if (warning.kind === "encrypted_message") return "Encrypted message";
  if (warning.kind === "signature_status") return "Signature status";
  return "Security warning";
}
