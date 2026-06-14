import type { DbAccount } from "@/services/db/accounts";
import { getAllAccounts } from "@/services/db/accounts";
import { listAccountDiagnostics } from "@/services/db/accountDiagnostics";
import { listQueueInspectorOperations, type QueueInspectorItem } from "@/services/db/pendingOperations";
import { listAccountSyncHealth, type AccountSyncHealth } from "@/services/syncHealth";
import type { ConnectionDiagnostic, DebugBundle, SupportDebugBundle } from "./types";
import { redactDebugBundleValue } from "./redaction";
import { summarizeSecurityWarnings, type SecurityWarning } from "@/services/security/securityWarnings";

const APP_VERSION = import.meta.env["VITE_APP_VERSION"] ?? "unknown";
const SUPPORT_BUNDLE_QUEUE_LIMIT = 50;

export interface BuildSupportDebugBundleInput {
  accounts: DbAccount[];
  diagnostics?: ConnectionDiagnostic[];
  syncHealth?: AccountSyncHealth[];
  queue?: QueueInspectorItem[];
  securityWarnings?: SecurityWarning[];
  app?: Partial<SupportDebugBundle["app"]>;
  scope?: {
    accountId?: string;
    includeQueue?: boolean;
    includeDiagnostics?: boolean;
  };
  exportedAt?: string;
}

export interface CollectSupportDebugBundleOptions {
  accountId?: string;
}

export interface SaveSupportDebugBundleResult {
  path?: string;
  fallback: boolean;
}

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

export function buildSupportDebugBundle(input: BuildSupportDebugBundleInput): SupportDebugBundle {
  const scope = {
    accountId: input.scope?.accountId,
    includeQueue: true as const,
    includeDiagnostics: true as const,
  };

  return redactDebugBundleValue({
    schemaVersion: 2,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    app: {
      name: "Office360 Mail",
      version: input.app?.version ?? APP_VERSION,
      tauriVersion: input.app?.tauriVersion,
      platform: input.app?.platform,
      arch: input.app?.arch,
      webview: input.app?.webview,
    },
    scope,
    accounts: input.accounts.map((account) => ({
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
      oauthProvider: account.oauth_provider,
      calendarProvider: account.calendar_provider,
    })),
    diagnostics: input.diagnostics ?? [],
    syncHealth: input.syncHealth ?? [],
    queue: input.queue ?? [],
    securityWarnings: summarizeSecurityWarnings(input.securityWarnings ?? []),
  });
}

export async function collectSupportDebugBundle(
  options: CollectSupportDebugBundleOptions = {},
): Promise<SupportDebugBundle> {
  const allAccounts = await getAllAccounts();
  const accounts = options.accountId
    ? allAccounts.filter((account) => account.id === options.accountId)
    : allAccounts;
  const accountIds = accounts.map((account) => account.id);
  const [diagnostics, syncHealth, queue, app] = await Promise.all([
    listAccountDiagnostics(options.accountId),
    listAccountSyncHealth(accountIds),
    listQueueInspectorOperations({
      accountId: options.accountId,
      status: "all",
      limit: SUPPORT_BUNDLE_QUEUE_LIMIT,
    }),
    collectSupportDebugBundleAppMetadata(),
  ]);

  return buildSupportDebugBundle({
    accounts,
    diagnostics,
    syncHealth,
    queue,
    app,
    scope: {
      accountId: options.accountId,
      includeQueue: true,
      includeDiagnostics: true,
    },
  });
}

export async function saveSupportDebugBundle(
  bundle: SupportDebugBundle,
): Promise<SaveSupportDebugBundleResult> {
  const contents = JSON.stringify(redactDebugBundleValue(bundle), null, 2);
  const defaultPath = supportDebugBundleFilename(bundle.exportedAt);

  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      defaultPath,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return { fallback: false };
    await writeTextFile(path, contents);
    return { path, fallback: false };
  } catch {
    triggerSupportBundleBrowserDownload(contents, defaultPath);
    return { fallback: true };
  }
}

async function collectSupportDebugBundleAppMetadata(): Promise<Partial<SupportDebugBundle["app"]>> {
  const metadata: Partial<SupportDebugBundle["app"]> = {
    version: APP_VERSION,
    webview: detectWebviewVersion(),
  };

  try {
    const { getVersion, getTauriVersion } = await import("@tauri-apps/api/app");
    metadata.version = await getVersion();
    metadata.tauriVersion = await getTauriVersion();
  } catch {
    // Browser preview or unavailable Tauri APIs keep the package version fallback.
  }

  try {
    const { platform, arch } = await import("@tauri-apps/plugin-os");
    metadata.platform = platform();
    metadata.arch = arch();
  } catch {
    // Browser preview has no OS plugin.
  }

  return metadata;
}

function detectWebviewVersion(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent;
  const edgMatch = /Edg\/(\S+)/.exec(ua);
  const chromeMatch = /Chrome\/(\S+)/.exec(ua);
  const webkitMatch = /AppleWebKit\/(\S+)/.exec(ua);
  return edgMatch?.[1] ?? chromeMatch?.[1] ?? webkitMatch?.[1];
}

function supportDebugBundleFilename(exportedAt: string): string {
  return `office360-support-bundle-${exportedAt.replace(/[:.]/g, "-")}.json`;
}

function triggerSupportBundleBrowserDownload(contents: string, filename: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") {
    throw new Error("Support bundle save is unavailable in this environment.");
  }

  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
