import { AlertTriangle, ImageOff, Paperclip, ShieldAlert, ShieldX } from "lucide-react";
import type { ReactNode } from "react";
import type { SecurityWarning, SecurityWarningAction } from "@/services/security/securityWarnings";
import { Banner, type BannerTone } from "@/components/ui/Banner";

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

/**
 * Security warnings on the shared Banner contract — DESIGN-001D.
 *
 * Visual layer only. Severity mapping, titles, icon selection, the action list
 * and every handler are unchanged; what changed is that the banner now uses one
 * tinted-surface treatment with dark text, instead of hand-rolled
 * `border-danger/30 bg-danger/10 text-danger` triples that differed from every
 * other banner in the app.
 */
export function SecurityWarningBanner({
  warning,
  onAction,
  onDismiss,
  trailing,
  className,
}: SecurityWarningBannerProps) {
  const tone = toneFor(warning.severity);
  const Icon = getIcon(warning.kind, warning.severity);
  const actions = onAction
    ? warning.actions.filter((action) => action !== "dismiss")
    : [];

  return (
    <Banner
      tone={tone}
      role={warning.severity === "danger" ? "alert" : "status"}
      icon={<Icon size={16} />}
      title={getTitle(warning)}
      trailing={trailing}
      onDismiss={onDismiss}
      dismissLabel="Dismiss warning"
      className={className}
      actions={
        actions.length > 0
          ? actions.map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => onAction?.(action)}
                className="focus-ring t-fast rounded-tight text-control font-semibold text-ink-primary underline-offset-2 hover:underline"
              >
                {ACTION_LABELS[action]}
              </button>
            ))
          : undefined
      }
    >
      <span className="block">{warning.reason}</span>
      <span className="mt-0.5 block text-ink-tertiary">{warning.recommendedAction}</span>
    </Banner>
  );
}

function toneFor(severity: SecurityWarning["severity"]): BannerTone {
  if (severity === "danger") return "danger";
  if (severity === "warning") return "warning";
  return "info";
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
