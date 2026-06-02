import { executeWrite, getDb } from "./connection";
import type {
  ConnectionDiagnostic,
  DiagnosticLayer,
  DiagnosticProvider,
  DiagnosticReason,
  DiagnosticRetryState,
  DiagnosticSeverity,
  DiagnosticUserAction,
} from "@/services/diagnostics";

export interface DbAccountDiagnostic {
  id: string;
  account_id: string | null;
  provider: DiagnosticProvider;
  layer: DiagnosticLayer;
  operation: string;
  reason: DiagnosticReason;
  severity: DiagnosticSeverity;
  retryable: number;
  retry_state: DiagnosticRetryState;
  retry_count: number;
  user_action: DiagnosticUserAction;
  user_message: string;
  debug_code: string;
  raw_cause: string | null;
  occurred_at: number;
  updated_at: number;
}

function rowToDiagnostic(row: DbAccountDiagnostic): ConnectionDiagnostic {
  return {
    accountId: row.account_id ?? undefined,
    provider: row.provider,
    layer: row.layer,
    operation: row.operation,
    reason: row.reason,
    severity: row.severity,
    retryable: row.retryable === 1,
    retryState: row.retry_state,
    retryCount: row.retry_count,
    userAction: row.user_action,
    userMessage: row.user_message,
    debugCode: row.debug_code,
    rawCause: row.raw_cause ?? undefined,
    occurredAt: row.occurred_at,
    updatedAt: row.updated_at,
  };
}

function diagnosticKey(diagnostic: ConnectionDiagnostic): string {
  const accountKey = diagnostic.accountId ?? "global";
  return `${accountKey}:${diagnostic.layer}:${diagnostic.operation}`;
}

export async function upsertAccountDiagnostic(diagnostic: ConnectionDiagnostic): Promise<void> {
  await executeWrite(
    `INSERT INTO account_diagnostics (
       id, account_id, provider, layer, operation, reason, severity, retryable,
       retry_state, retry_count, user_action, user_message, debug_code, raw_cause,
       occurred_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT(account_id, layer, operation) DO UPDATE SET
       provider = excluded.provider,
       reason = excluded.reason,
       severity = excluded.severity,
       retryable = excluded.retryable,
       retry_state = excluded.retry_state,
       retry_count = excluded.retry_count,
       user_action = excluded.user_action,
       user_message = excluded.user_message,
       debug_code = excluded.debug_code,
       raw_cause = excluded.raw_cause,
       occurred_at = excluded.occurred_at,
       updated_at = excluded.updated_at`,
    [
      diagnosticKey(diagnostic),
      diagnostic.accountId ?? null,
      diagnostic.provider,
      diagnostic.layer,
      diagnostic.operation,
      diagnostic.reason,
      diagnostic.severity,
      diagnostic.retryable ? 1 : 0,
      diagnostic.retryState,
      diagnostic.retryCount,
      diagnostic.userAction,
      diagnostic.userMessage,
      diagnostic.debugCode,
      diagnostic.rawCause ?? null,
      diagnostic.occurredAt,
      diagnostic.updatedAt,
    ],
  );
}

export async function listAccountDiagnostics(accountId?: string): Promise<ConnectionDiagnostic[]> {
  const db = await getDb();
  const rows = accountId
    ? await db.select<DbAccountDiagnostic[]>(
      `SELECT * FROM account_diagnostics
       WHERE account_id = $1
       ORDER BY severity DESC, updated_at DESC`,
      [accountId],
    )
    : await db.select<DbAccountDiagnostic[]>(
      "SELECT * FROM account_diagnostics ORDER BY updated_at DESC",
    );
  return rows.map(rowToDiagnostic);
}

export async function getLatestDiagnosticForAccount(accountId: string): Promise<ConnectionDiagnostic | null> {
  const db = await getDb();
  const rows = await db.select<DbAccountDiagnostic[]>(
    `SELECT * FROM account_diagnostics
     WHERE account_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [accountId],
  );
  return rows[0] ? rowToDiagnostic(rows[0]) : null;
}

export async function clearAccountDiagnostic(
  accountId: string,
  layer: DiagnosticLayer,
  operation: string,
): Promise<void> {
  await executeWrite(
    "DELETE FROM account_diagnostics WHERE account_id = $1 AND layer = $2 AND operation = $3",
    [accountId, layer, operation],
  );
}

export async function clearDiagnosticsForAccount(accountId: string): Promise<void> {
  await executeWrite("DELETE FROM account_diagnostics WHERE account_id = $1", [accountId]);
}
