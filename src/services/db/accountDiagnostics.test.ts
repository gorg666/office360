import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionDiagnostic } from "@/services/diagnostics";

const { mockExecuteWrite, mockGetDb } = vi.hoisted(() => ({
  mockExecuteWrite: vi.fn(),
  mockGetDb: vi.fn(),
}));

vi.mock("@/services/db/connection", () => ({
  executeWrite: mockExecuteWrite,
  getDb: mockGetDb,
}));

import {
  clearAccountDiagnostic,
  getLatestDiagnosticForAccount,
  listAccountDiagnostics,
  upsertAccountDiagnostic,
} from "./accountDiagnostics";

const diagnostic: ConnectionDiagnostic = {
  accountId: "acc-1",
  provider: "imap",
  layer: "imap",
  operation: "test_connection",
  reason: "tls_failed",
  severity: "blocked",
  retryable: false,
  retryState: "blocked",
  retryCount: 0,
  userAction: "check_tls",
  userMessage: "TLS failed",
  debugCode: "IMAP.TEST_CONNECTION.TLS_FAILED",
  rawCause: "TLS certificate failed",
  occurredAt: 100,
  updatedAt: 100,
};

describe("accountDiagnostics db service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts latest diagnostic per account layer operation", async () => {
    await upsertAccountDiagnostic(diagnostic);

    expect(mockExecuteWrite).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT(account_id, layer, operation) DO UPDATE"),
      expect.arrayContaining([
        "acc-1:imap:test_connection",
        "acc-1",
        "imap",
        "imap",
        "test_connection",
        "tls_failed",
      ]),
    );
  });

  it("lists diagnostics for account", async () => {
    mockGetDb.mockResolvedValueOnce({
      select: vi.fn().mockResolvedValueOnce([{
        id: "acc-1:imap:test_connection",
        account_id: "acc-1",
        provider: "imap",
        layer: "imap",
        operation: "test_connection",
        reason: "tls_failed",
        severity: "blocked",
        retryable: 0,
        retry_state: "blocked",
        retry_count: 0,
        user_action: "check_tls",
        user_message: "TLS failed",
        debug_code: "IMAP.TEST_CONNECTION.TLS_FAILED",
        raw_cause: "TLS certificate failed",
        occurred_at: 100,
        updated_at: 100,
      }]),
    });

    const result = await listAccountDiagnostics("acc-1");

    expect(result).toEqual([diagnostic]);
  });

  it("returns latest diagnostic", async () => {
    mockGetDb.mockResolvedValueOnce({
      select: vi.fn().mockResolvedValueOnce([]),
    });

    await expect(getLatestDiagnosticForAccount("acc-1")).resolves.toBeNull();
  });

  it("clears a diagnostic", async () => {
    await clearAccountDiagnostic("acc-1", "imap", "test_connection");

    expect(mockExecuteWrite).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM account_diagnostics"),
      ["acc-1", "imap", "test_connection"],
    );
  });
});
