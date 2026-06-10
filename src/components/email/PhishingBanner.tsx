import type { MessageScanResult } from "@/utils/phishingDetector";
import { SecurityWarningBanner } from "./SecurityWarningBanner";
import { createSuspiciousLinkWarning } from "@/services/security/securityWarnings";

interface PhishingBannerProps {
  accountId: string;
  messageId: string;
  scanResult: MessageScanResult;
  onTrustSender: () => void;
}

export function PhishingBanner({
  accountId,
  messageId,
  scanResult,
  onTrustSender,
}: PhishingBannerProps) {
  const warning = createSuspiciousLinkWarning({ accountId, messageId, scanResult });
  if (!warning) return null;

  return (
    <SecurityWarningBanner
      warning={warning}
      className="mb-3"
      trailing={(
      <button
        onClick={onTrustSender}
          className="shrink-0 rounded-md border border-warning/30 px-2.5 py-1 text-xs text-warning transition-colors hover:bg-warning/5 hover:text-warning/80"
      >
        Trust this sender
      </button>
      )}
    />
  );
}
