import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDebugBundle, buildSupportDebugBundle, saveSupportDebugBundle } from "./debugBundle";
import type { DbAccount } from "@/services/db/accounts";
import type { ConnectionDiagnostic } from "./types";
import { createUnsafeAttachmentWarning } from "@/services/security/securityWarnings";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  BaseDirectory: { AppData: 26 },
}));

const account: DbAccount = {
  id: "acc-1",
  email: "user@example.com",
  display_name: "User",
  avatar_url: null,
  access_token: "secret-access-token",
  refresh_token: "secret-refresh-token",
  token_expires_at: null,
  history_id: null,
  last_sync_at: null,
  is_active: 1,
  provider: "imap",
  imap_host: "imap.example.com",
  imap_port: 993,
  imap_security: "tls",
  smtp_host: "smtp.example.com",
  smtp_port: 465,
  smtp_security: "tls",
  auth_method: "password",
  imap_password: "secret-password",
  oauth_provider: null,
  oauth_client_id: null,
  oauth_client_secret: null,
  imap_username: "user@example.com",
  accept_invalid_certs: 0,
  calendar_provider: null,
  caldav_url: null,
  caldav_username: null,
  caldav_password: null,
  caldav_principal_url: null,
  caldav_home_url: null,
  created_at: 1,
  updated_at: 1,
};

const diagnostic: ConnectionDiagnostic = {
  accountId: "acc-1",
  provider: "imap",
  layer: "imap",
  operation: "sync",
  reason: "provider_error",
  severity: "error",
  retryable: true,
  retryState: "idle",
  retryCount: 0,
  userMessage: "Sync failed",
  userAction: "retry",
  debugCode: "IMAP.SYNC.PROVIDER_ERROR",
  rawCause: "token=secret-token Subject: Private body",
  occurredAt: 1,
  updatedAt: 1,
};

describe("buildDebugBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redacts account secrets and security warning summaries", () => {
    const bundle = buildDebugBundle(
      [account],
      [diagnostic],
      [createUnsafeAttachmentWarning({
        accountId: "acc-1",
        messageId: "msg-1",
        filename: "invoice.exe",
        mimeType: "application/x-msdownload",
      })],
    );

    const json = JSON.stringify(bundle);
    expect(json).not.toContain("secret-access-token");
    expect(json).not.toContain("secret-refresh-token");
    expect(json).not.toContain("secret-password");
    expect(json).not.toContain("Private body");
    expect(bundle.securityWarnings?.[0]?.kind).toBe("unsafe_attachment");
    expect(bundle.securityWarnings?.[0]?.reason).toContain("invoice.exe");
  });

  it("builds schema v2 support bundle with diagnostics, sync health, and redacted queue summaries", () => {
    const bundle = buildSupportDebugBundle({
      accounts: [account],
      diagnostics: [diagnostic],
      syncHealth: [{
        accountId: "acc-1",
        status: "failed",
        lastSuccessfulSyncAt: null,
        lastAttemptAt: 2,
        pendingCount: 1,
        failedCount: 1,
        blockedReason: "password=secret-password",
        diagnosticCode: "IMAP.SYNC.PROVIDER_ERROR",
        userAction: "export_debug",
        queue: {
          pending: 1,
          executing: 0,
          retryScheduled: 0,
          failed: 1,
          blocked: 0,
          cancelled: 0,
          active: 2,
          total: 2,
        },
      }],
      queue: [{
        id: "op-1",
        accountId: "acc-1",
        operationType: "sendMessage",
        resourceId: "draft-1",
        status: "failed",
        retryCount: 1,
        maxRetries: 10,
        nextRetryAt: null,
        createdAt: 1,
        updatedAt: 2,
        lastError: "Bearer secret-token",
        blockedReason: "client_secret=secret-client",
        diagnosticCode: "SMTP.SEND.PROVIDER_ERROR",
        userAction: "export_debug",
        preview: {
          title: "Отправить письмо",
          subtitle: "recipient@example.com",
          fields: [{ label: "Тип", value: "Отправка письма" }],
        },
        actions: ["retry", "export_debug"],
      }],
      securityWarnings: [createUnsafeAttachmentWarning({
        accountId: "acc-1",
        messageId: "msg-1",
        filename: "invoice.exe",
        mimeType: "application/x-msdownload",
      })],
      app: {
        version: "0.4.21",
        tauriVersion: "2.0.0",
        platform: "macos",
        arch: "aarch64",
        webview: "537.36",
      },
      scope: {
        accountId: "acc-1",
        includeQueue: true,
        includeDiagnostics: true,
      },
      exportedAt: "2026-06-14T10:00:00.000Z",
    });

    expect(bundle.schemaVersion).toBe(2);
    expect(bundle.scope.accountId).toBe("acc-1");
    expect(bundle.app.platform).toBe("macos");
    expect(bundle.accounts[0]).toEqual({
      id: "acc-1",
      email: "user@example.com",
      provider: "imap",
      authMethod: "password",
      imapHost: "imap.example.com",
      imapPort: 993,
      imapSecurity: "tls",
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpSecurity: "tls",
      oauthProvider: null,
      calendarProvider: null,
    });
    expect(bundle.syncHealth[0]?.blockedReason).toBe("password=[redacted]");
    expect(bundle.queue[0]?.lastError).toBe("Bearer [redacted]");
    expect(bundle.queue[0]?.blockedReason).toBe("client_secret=[redacted]");
    expect(bundle.securityWarnings?.[0]?.kind).toBe("unsafe_attachment");

    const json = JSON.stringify(bundle);
    expect(json).not.toContain("secret-access-token");
    expect(json).not.toContain("secret-refresh-token");
    expect(json).not.toContain("secret-password");
    expect(json).not.toContain("secret-client");
    expect(json).not.toContain("rawBase64Url");
    expect(json).not.toContain("Private body");
  });

  it("saves support bundle through the desktop file dialog", async () => {
    vi.mocked(save).mockResolvedValue("/tmp/support.json");
    const bundle = buildSupportDebugBundle({
      accounts: [account],
      exportedAt: "2026-06-14T10:00:00.000Z",
    });

    const result = await saveSupportDebugBundle(bundle);

    expect(result).toEqual({ path: "/tmp/support.json", fallback: false });
    expect(save).toHaveBeenCalledWith({
      defaultPath: "office360-support-bundle-2026-06-14T10-00-00-000Z.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    expect(writeTextFile).toHaveBeenCalledWith(
      "/tmp/support.json",
      expect.stringContaining('"schemaVersion": 2'),
    );
  });
});
