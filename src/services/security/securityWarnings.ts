import type { MessageScanResult, LinkAnalysis } from "@/utils/phishingDetector";

export type SecurityWarningKind =
  | "remote_content"
  | "suspicious_link"
  | "sender_auth"
  | "unsafe_attachment"
  | "encrypted_message"
  | "signature_status"
  | "spoofing_risk";

export type SecurityWarningSeverity = "info" | "warning" | "danger";

export type SecurityWarningAction =
  | "allow_once"
  | "always_allow_sender"
  | "inspect"
  | "download"
  | "open_external"
  | "report"
  | "dismiss";

export interface SecurityWarning {
  id: string;
  accountId: string;
  messageId: string;
  kind: SecurityWarningKind;
  severity: SecurityWarningSeverity;
  reason: string;
  recommendedAction: string;
  actions: SecurityWarningAction[];
  persistentChoice?: boolean;
}

export interface SecurityWarningSummary {
  id: string;
  accountId: string;
  messageId: string;
  kind: SecurityWarningKind;
  severity: SecurityWarningSeverity;
  reason: string;
  recommendedAction: string;
  actions: SecurityWarningAction[];
  persistentChoice?: boolean;
}

const EXECUTABLE_EXTENSIONS = new Set([
  "app", "apk", "bat", "bin", "cmd", "com", "cpl", "dll", "dmg", "exe", "gadget",
  "hta", "jar", "js", "jse", "lnk", "msi", "msp", "pkg", "ps1", "scr", "sh", "vbe",
  "vbs", "wsf",
]);

const RISKY_ARCHIVE_EXTENSIONS = new Set(["7z", "ace", "gz", "rar", "tar", "xz", "zip"]);

export function createRemoteContentWarning(input: {
  accountId: string;
  messageId: string;
  senderAddress?: string | null;
  isSpam?: boolean;
}): SecurityWarning {
  const reason = input.isSpam
    ? "Remote images are blocked because this message is in spam."
    : "Remote images are hidden to protect your privacy.";

  return {
    id: `remote-content:${input.messageId}`,
    accountId: input.accountId,
    messageId: input.messageId,
    kind: "remote_content",
    severity: input.isSpam ? "warning" : "info",
    reason,
    recommendedAction: "Load images only if you trust this message.",
    actions: input.senderAddress && !input.isSpam
      ? ["allow_once", "always_allow_sender"]
      : ["allow_once"],
    persistentChoice: Boolean(input.senderAddress && !input.isSpam),
  };
}

export function createSuspiciousLinkWarning(input: {
  accountId: string;
  messageId: string;
  scanResult: MessageScanResult;
}): SecurityWarning | null {
  if (!input.scanResult.showBanner) return null;

  const highRisk = input.scanResult.maxRiskScore >= 60;
  const count = input.scanResult.suspiciousLinkCount;

  return {
    id: `suspicious-link:${input.messageId}`,
    accountId: input.accountId,
    messageId: input.messageId,
    kind: "suspicious_link",
    severity: highRisk ? "danger" : "warning",
    reason: count === 1
      ? "1 suspicious link was detected in this message."
      : `${count} suspicious links were detected in this message.`,
    recommendedAction: "Inspect links before opening them.",
    actions: ["inspect", "open_external", "dismiss"],
  };
}

export function createSenderAuthWarning(input: {
  accountId: string;
  messageId: string;
  senderAddress?: string | null;
}): SecurityWarning {
  return {
    id: `sender-auth:${input.messageId}`,
    accountId: input.accountId,
    messageId: input.messageId,
    kind: "sender_auth",
    severity: "danger",
    reason: `This message from ${input.senderAddress ?? "this sender"} failed SPF/DKIM/DMARC authentication checks.`,
    recommendedAction: "Be cautious with links and attachments.",
    actions: ["inspect", "dismiss"],
  };
}

export function createUnsafeAttachmentWarning(input: {
  accountId: string;
  messageId: string;
  filename?: string | null;
  mimeType?: string | null;
}): SecurityWarning {
  const filename = input.filename ?? "this attachment";
  return {
    id: `unsafe-attachment:${input.messageId}:${filename}`,
    accountId: input.accountId,
    messageId: input.messageId,
    kind: "unsafe_attachment",
    severity: isExecutableAttachment(input.filename, input.mimeType) ? "danger" : "warning",
    reason: `${filename} can contain executable or packaged content.`,
    recommendedAction: "Open or download it only if you trust the sender.",
    actions: ["download", "open_external", "dismiss"],
  };
}

export function isRiskyAttachment(filename?: string | null, mimeType?: string | null): boolean {
  return isExecutableAttachment(filename, mimeType) || isRiskyArchive(filename, mimeType);
}

export function isExecutableAttachment(filename?: string | null, mimeType?: string | null): boolean {
  const ext = getExtension(filename);
  if (ext && EXECUTABLE_EXTENSIONS.has(ext)) return true;
  const normalizedMime = mimeType?.toLowerCase() ?? "";
  return normalizedMime.includes("x-msdownload")
    || normalizedMime.includes("x-msdos-program")
    || normalizedMime.includes("x-sh")
    || normalizedMime.includes("x-executable");
}

export function summarizeSecurityWarnings(warnings: SecurityWarning[]): SecurityWarningSummary[] {
  return warnings.map((warning) => ({
    id: sanitizeSummaryText(warning.id, 160),
    accountId: sanitizeSummaryText(warning.accountId, 160),
    messageId: sanitizeSummaryText(warning.messageId, 160),
    kind: warning.kind,
    severity: warning.severity,
    reason: sanitizeSummaryText(warning.reason, 240),
    recommendedAction: sanitizeSummaryText(warning.recommendedAction, 240),
    actions: warning.actions,
    persistentChoice: warning.persistentChoice,
  }));
}

export function findLinkAnalysis(
  scanResult: MessageScanResult | null | undefined,
  href: string,
  displayText: string,
): LinkAnalysis | null {
  if (!scanResult) return null;

  const normalizedHref = normalizeUrlForCompare(href);
  const normalizedDisplay = displayText.trim();
  const match = scanResult.links.find((link) =>
    normalizeUrlForCompare(link.url) === normalizedHref
    && (!link.displayText || link.displayText.trim() === normalizedDisplay),
  ) ?? scanResult.links.find((link) => normalizeUrlForCompare(link.url) === normalizedHref);

  if (!match || match.riskLevel === "safe" || match.riskLevel === "low") return null;
  return match;
}

function isRiskyArchive(filename?: string | null, mimeType?: string | null): boolean {
  const ext = getExtension(filename);
  if (ext && RISKY_ARCHIVE_EXTENSIONS.has(ext)) return true;
  const normalizedMime = mimeType?.toLowerCase() ?? "";
  return normalizedMime.includes("zip")
    || normalizedMime.includes("compressed")
    || normalizedMime.includes("archive")
    || normalizedMime.includes("tar");
}

function getExtension(filename?: string | null): string | null {
  const clean = filename?.trim().toLowerCase();
  if (!clean) return null;
  const dot = clean.lastIndexOf(".");
  if (dot === -1 || dot === clean.length - 1) return null;
  return clean.slice(dot + 1);
}

function normalizeUrlForCompare(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}

function sanitizeSummaryText(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}
