import { describe, expect, it } from "vitest";
import { buildDebugBundle } from "./debugBundle";
import type { DbAccount } from "@/services/db/accounts";
import type { ConnectionDiagnostic } from "./types";
import { createUnsafeAttachmentWarning } from "@/services/security/securityWarnings";

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
});
