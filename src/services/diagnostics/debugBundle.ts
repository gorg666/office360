import type { DbAccount } from "@/services/db/accounts";
import type { ConnectionDiagnostic, DebugBundle } from "./types";
import { redactDebugBundleValue } from "./redaction";
import { summarizeSecurityWarnings, type SecurityWarning } from "@/services/security/securityWarnings";

const APP_VERSION = import.meta.env["VITE_APP_VERSION"] ?? "unknown";

export function buildDebugBundle(
  accounts: DbAccount[],
  diagnostics: ConnectionDiagnostic[],
  securityWarnings: SecurityWarning[] = [],
): DebugBundle {
  return redactDebugBundleValue({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: {
      name: "Office360 Mail",
      version: APP_VERSION,
    },
    accounts: accounts.map((account) => ({
      id: account.id,
      email: account.email,
      provider: account.provider,
      authMethod: account.auth_method,
      imapHost: account.imap_host,
      imapPort: account.imap_port,
      imapSecurity: account.imap_security,
      smtpHost: account.smtp_host,
      smtpPort: account.smtp_port,
      smtpSecurity: account.smtp_security,
      calendarProvider: account.calendar_provider,
    })),
    diagnostics,
    securityWarnings: summarizeSecurityWarnings(securityWarnings),
  });
}
