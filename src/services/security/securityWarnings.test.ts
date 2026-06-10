import { describe, expect, it } from "vitest";
import {
  createRemoteContentWarning,
  createSuspiciousLinkWarning,
  createUnsafeAttachmentWarning,
  findLinkAnalysis,
  isRiskyAttachment,
  summarizeSecurityWarnings,
} from "./securityWarnings";
import type { MessageScanResult } from "@/utils/phishingDetector";

function makeScanResult(overrides: Partial<MessageScanResult> = {}): MessageScanResult {
  return {
    messageId: "msg-1",
    links: [
      {
        url: "https://evil.example/login",
        displayText: "https://bank.example/login",
        riskScore: 60,
        riskLevel: "high",
        triggeredRules: [{ ruleId: "display-mismatch", name: "Mismatch", score: 60, detail: "mismatch" }],
      },
    ],
    maxRiskScore: 60,
    suspiciousLinkCount: 1,
    showBanner: true,
    scannedAt: 1,
    ...overrides,
  };
}

describe("security warning model", () => {
  it("blocks spam remote content without persistent sender allowlist action", () => {
    const warning = createRemoteContentWarning({
      accountId: "acc-1",
      messageId: "msg-1",
      senderAddress: "sender@example.com",
      isSpam: true,
    });

    expect(warning.severity).toBe("warning");
    expect(warning.actions).toEqual(["allow_once"]);
    expect(warning.persistentChoice).toBe(false);
  });

  it("creates suspicious link warnings only when scan result should show a banner", () => {
    expect(createSuspiciousLinkWarning({
      accountId: "acc-1",
      messageId: "msg-1",
      scanResult: makeScanResult(),
    })?.severity).toBe("danger");

    expect(createSuspiciousLinkWarning({
      accountId: "acc-1",
      messageId: "msg-1",
      scanResult: makeScanResult({ showBanner: false }),
    })).toBeNull();
  });

  it("detects executable and archive attachments", () => {
    expect(isRiskyAttachment("invoice.exe", "application/octet-stream")).toBe(true);
    expect(isRiskyAttachment("bundle.zip", "application/zip")).toBe(true);
    expect(isRiskyAttachment("report.pdf", "application/pdf")).toBe(false);
  });

  it("summarizes warnings without raw control characters", () => {
    const summary = summarizeSecurityWarnings([
      createUnsafeAttachmentWarning({
        accountId: "acc-1",
        messageId: "msg-1",
        filename: "run.exe\u0000secret",
        mimeType: "application/x-msdownload",
      }),
    ]);

    expect(JSON.stringify(summary)).not.toContain("\u0000");
    expect(summary[0]?.kind).toBe("unsafe_attachment");
  });

  it("finds link analysis for high-risk scanned links", () => {
    const match = findLinkAnalysis(makeScanResult(), "https://evil.example/login", "https://bank.example/login");
    expect(match?.riskLevel).toBe("high");
  });
});
