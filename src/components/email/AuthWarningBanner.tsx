import type { AuthResult } from "@/services/gmail/authParser";
import { SecurityWarningBanner } from "./SecurityWarningBanner";
import { createSenderAuthWarning } from "@/services/security/securityWarnings";

interface AuthWarningBannerProps {
  authResults: string | null;
  accountId?: string;
  messageId?: string;
  senderAddress: string | null;
  onDismiss: () => void;
}

export function AuthWarningBanner({
  authResults,
  accountId = "unknown",
  messageId = "message",
  senderAddress,
  onDismiss,
}: AuthWarningBannerProps) {
  if (!authResults) return null;

  let parsed: AuthResult;
  try {
    parsed = JSON.parse(authResults) as AuthResult;
  } catch {
    return null;
  }

  if (parsed.aggregate !== "fail") return null;

  const warning = createSenderAuthWarning({
    accountId,
    messageId,
    senderAddress,
  });

  return (
    <SecurityWarningBanner
      warning={warning}
      onDismiss={onDismiss}
      className="mb-3"
    />
  );
}
