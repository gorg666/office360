import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountSyncHealth, recordSyncHealthStatus } from "./syncHealth";
import { getAccount } from "@/services/db/accounts";
import { listAccountDiagnostics } from "@/services/db/accountDiagnostics";
import { getQueueSummary } from "@/services/db/pendingOperations";
import { createMockUIStoreState } from "@/test/mocks";

vi.mock("@/services/db/accounts", () => ({
  getAccount: vi.fn(),
  getAllAccounts: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/services/db/accountDiagnostics", () => ({
  listAccountDiagnostics: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/services/db/pendingOperations", () => ({
  getQueueSummary: vi.fn(() => Promise.resolve({
    pending: 0,
    executing: 0,
    retryScheduled: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
    active: 0,
    total: 0,
  })),
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: vi.fn(() => createMockUIStoreState({ isOnline: true })),
  },
}));

describe("syncHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccount).mockResolvedValue({
      id: "acct-1",
      email: "user@example.com",
      display_name: null,
      avatar_url: null,
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      history_id: null,
      last_sync_at: 100,
      is_active: 1,
      created_at: 1,
      updated_at: 1,
      provider: "imap",
      imap_host: null,
      imap_port: null,
      imap_security: null,
      smtp_host: null,
      smtp_port: null,
      smtp_security: null,
      auth_method: "password",
      imap_password: null,
      oauth_provider: null,
      oauth_client_id: null,
      oauth_client_secret: null,
      imap_username: null,
      caldav_url: null,
      caldav_username: null,
      caldav_password: null,
      caldav_principal_url: null,
      caldav_home_url: null,
      calendar_provider: null,
      accept_invalid_certs: 0,
    });
  });

  it("returns queued when queue has pending work", async () => {
    vi.mocked(getQueueSummary).mockResolvedValueOnce({
      pending: 1,
      executing: 0,
      retryScheduled: 1,
      failed: 0,
      blocked: 0,
      cancelled: 0,
      active: 2,
      total: 2,
    });

    const health = await getAccountSyncHealth("acct-1");
    expect(health?.status).toBe("queued");
    expect(health?.pendingCount).toBe(2);
  });

  it("returns failed for auth diagnostics", async () => {
    vi.mocked(listAccountDiagnostics).mockResolvedValueOnce([
      {
        accountId: "acct-1",
        provider: "imap",
        layer: "oauth",
        operation: "refresh",
        reason: "expired_token",
        severity: "blocked",
        retryable: false,
        retryState: "blocked",
        retryCount: 0,
        userAction: "reauth",
        userMessage: "Войдите заново",
        debugCode: "OAUTH.REFRESH.EXPIRED_TOKEN",
        occurredAt: 100,
        updatedAt: 120,
      },
    ]);

    const health = await getAccountSyncHealth("acct-1");
    expect(health?.status).toBe("failed");
    expect(health?.userAction).toBe("reauth");
    expect(health?.diagnosticCode).toBe("OAUTH.REFRESH.EXPIRED_TOKEN");
  });

  it("tracks syncing status", async () => {
    recordSyncHealthStatus("acct-1", "syncing");
    const health = await getAccountSyncHealth("acct-1");
    expect(health?.status).toBe("syncing");
    recordSyncHealthStatus("acct-1", "done");
  });
});
