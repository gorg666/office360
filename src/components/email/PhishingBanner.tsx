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
          type="button"
          onClick={onTrustSender}
          className="focus-ring t-fast shrink-0 self-start rounded-control border border-outline bg-surface-solid px-2.5 py-1 text-control font-medium text-ink-secondary hover:bg-surface-sunken hover:text-ink-primary"
        >
          Trust this sender
        </button>
      )}
    />
  );
}
