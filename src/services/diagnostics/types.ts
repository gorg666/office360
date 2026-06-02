export type DiagnosticLayer =
  | "oauth"
  | "imap"
  | "smtp"
  | "gmail_api"
  | "caldav"
  | "database"
  | "network"
  | "provider";

export type DiagnosticReason =
  | "invalid_credentials"
  | "expired_token"
  | "missing_scope"
  | "server_unreachable"
  | "dns_failed"
  | "tls_failed"
  | "timeout"
  | "quota"
  | "rate_limited"
  | "unsupported_capability"
  | "provider_error"
  | "local_database_error"
  | "unknown";

export type DiagnosticSeverity = "info" | "warning" | "error" | "blocked";

export type DiagnosticUserAction =
  | "retry"
  | "reauth"
  | "edit_settings"
  | "check_password"
  | "check_tls"
  | "wait"
  | "contact_admin"
  | "export_debug";

export type DiagnosticRetryState = "idle" | "retrying" | "scheduled" | "failed" | "blocked";

export type DiagnosticProvider = "gmail_api" | "imap" | "caldav" | "exchange" | "unknown";

export interface ConnectionDiagnostic {
  accountId?: string;
  provider: DiagnosticProvider;
  layer: DiagnosticLayer;
  operation: string;
  reason: DiagnosticReason;
  severity: DiagnosticSeverity;
  retryable: boolean;
  retryState: DiagnosticRetryState;
  retryCount: number;
  userMessage: string;
  userAction: DiagnosticUserAction;
  debugCode: string;
  rawCause?: string;
  occurredAt: number;
  updatedAt: number;
}

export interface DiagnosticContext {
  accountId?: string;
  provider?: DiagnosticProvider | string | null;
  layer: DiagnosticLayer;
  operation: string;
  authMethod?: string | null;
  retryState?: DiagnosticRetryState;
  retryCount?: number;
}

export interface DebugBundle {
  schemaVersion: 1;
  exportedAt: string;
  app: {
    name: "Office360 Mail";
    version: string;
  };
  accounts: Array<{
    id: string;
    email: string;
    provider: string | null;
    authMethod?: string | null;
    imapHost?: string | null;
    imapPort?: number | null;
    imapSecurity?: string | null;
    smtpHost?: string | null;
    smtpPort?: number | null;
    smtpSecurity?: string | null;
    calendarProvider?: string | null;
  }>;
  diagnostics: ConnectionDiagnostic[];
}
