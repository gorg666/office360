import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  KeyRound,
  Loader2,
  RefreshCw,
  Settings,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { getAllAccounts, getAccount, updateOAuthImapAccount, type DbAccount } from "@/services/db/accounts";
import { clearAccountDiagnostic, listAccountDiagnostics } from "@/services/db/accountDiagnostics";
import { buildDebugBundle, type ConnectionDiagnostic } from "@/services/diagnostics";
import { triggerSync } from "@/services/gmail/syncManager";
import { reauthorizeAccount } from "@/services/gmail/tokenManager";
import { getOAuthProvider } from "@/services/oauth/providers";
import { startProviderOAuthFlow } from "@/services/oauth/oauthFlow";
import { normalizeEmail } from "@/utils/emailUtils";
import { navigateBackFromRepair, navigateToSettings } from "@/router/navigate";
import { Button } from "@/components/ui/Button";

type ActionState = "idle" | "running" | "done" | "error";

function providerLabel(account: DbAccount): string {
  if (account.provider === "imap" && account.oauth_provider === "yandex") return "Yandex IMAP/SMTP";
  if (account.provider === "imap") return account.auth_method === "oauth2" ? "OAuth IMAP/SMTP" : "IMAP/SMTP";
  if (account.provider === "gmail_api") return "Gmail API";
  if (account.provider === "caldav") return "CalDAV";
  return account.provider;
}

function severityClasses(diagnostic: ConnectionDiagnostic): string {
  if (diagnostic.severity === "info") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";
  if (diagnostic.severity === "warning") return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  return "border-danger/30 bg-danger/10 text-danger";
}

function formatTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString();
}

function actionLabel(action: ConnectionDiagnostic["userAction"]): string {
  switch (action) {
    case "reauth":
      return "Авторизовать заново";
    case "edit_settings":
      return "Изменить настройки";
    case "check_password":
      return "Проверить пароль";
    case "check_tls":
      return "Проверить TLS";
    case "wait":
      return "Повторить позже";
    case "contact_admin":
      return "Связаться с администратором";
    case "export_debug":
      return "Экспорт debug";
    case "retry":
      return "Повторить";
  }
}

export function AccountRepairCenter() {
  const { accountId } = useParams({ strict: false }) as { accountId?: string };
  const [accounts, setAccounts] = useState<DbAccount[]>([]);
  const [diagnostics, setDiagnostics] = useState<ConnectionDiagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionState, setActionState] = useState<Record<string, ActionState>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dbAccounts, dbDiagnostics] = await Promise.all([
        getAllAccounts(),
        listAccountDiagnostics(accountId),
      ]);
      setAccounts(dbAccounts.filter((account) => !accountId || account.id === accountId));
      setDiagnostics(dbDiagnostics);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const diagnosticsByAccount = useMemo(() => {
    const map = new Map<string, ConnectionDiagnostic[]>();
    for (const diagnostic of diagnostics) {
      if (!diagnostic.accountId) continue;
      const items = map.get(diagnostic.accountId) ?? [];
      items.push(diagnostic);
      map.set(diagnostic.accountId, items);
    }
    return map;
  }, [diagnostics]);

  const setRunning = (key: string, state: ActionState) => {
    setActionState((prev) => ({ ...prev, [key]: state }));
  };

  const handleRetry = useCallback(async (selectedAccountId: string) => {
    const key = `retry:${selectedAccountId}`;
    setRunning(key, "running");
    setActionError(null);
    try {
      await triggerSync([selectedAccountId]);
      setRunning(key, "done");
      await load();
    } catch (err) {
      setRunning(key, "error");
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [load]);

  const handleReauth = useCallback(async (selectedAccountId: string) => {
    const key = `reauth:${selectedAccountId}`;
    setRunning(key, "running");
    setActionError(null);
    try {
      const account = await getAccount(selectedAccountId);
      if (!account) throw new Error("Account not found");

      if (account.provider === "gmail_api") {
        await reauthorizeAccount(account.id, account.email);
      } else if (account.provider === "imap" && account.auth_method === "oauth2" && account.oauth_provider) {
        const provider = getOAuthProvider(account.oauth_provider);
        if (!provider) throw new Error(`Unknown OAuth provider: ${account.oauth_provider}`);
        if (!account.oauth_client_id) throw new Error("OAuth client ID is missing");
        if (!account.imap_host || !account.imap_port || !account.imap_security || !account.smtp_host || !account.smtp_port || !account.smtp_security) {
          throw new Error("IMAP/SMTP settings are incomplete");
        }
        const { tokens, userInfo } = await startProviderOAuthFlow(
          provider,
          account.oauth_client_id,
          account.oauth_client_secret ?? undefined,
          account.oauth_provider === "yandex" ? { loginHint: account.email } : undefined,
        );
        if (userInfo.email && normalizeEmail(userInfo.email) !== normalizeEmail(account.email)) {
          throw new Error(`Signed in as ${userInfo.email}, but expected ${account.email}.`);
        }
        const refreshToken = tokens.refresh_token ?? account.refresh_token;
        if (!refreshToken) throw new Error("OAuth provider did not return a refresh token.");
        if (!tokens.access_token) throw new Error("OAuth provider did not return an access token.");

        await updateOAuthImapAccount({
          id: account.id,
          email: userInfo.email || account.email,
          displayName: userInfo.name || account.display_name,
          avatarUrl: userInfo.picture ?? account.avatar_url,
          imapHost: account.imap_host,
          imapPort: account.imap_port,
          imapSecurity: account.imap_security,
          smtpHost: account.smtp_host,
          smtpPort: account.smtp_port,
          smtpSecurity: account.smtp_security,
          accessToken: tokens.access_token,
          refreshToken,
          tokenExpiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
          oauthProvider: account.oauth_provider,
          oauthClientId: account.oauth_client_id,
          oauthClientSecret: account.oauth_client_secret,
          imapUsername: account.imap_username,
          acceptInvalidCerts: account.accept_invalid_certs === 1,
        });
      } else {
        navigateToSettings("accounts");
        return;
      }

      await clearAccountDiagnostic(account.id, "oauth", "refresh").catch((dbErr) => {
        console.warn("[diagnostics] Failed to clear OAuth diagnostic after reauth:", dbErr);
      });
      setRunning(key, "done");
      await load();
    } catch (err) {
      setRunning(key, "error");
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [load]);

  const handleExport = useCallback(() => {
    const bundle = buildDebugBundle(accounts, diagnostics);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `office360-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [accounts, diagnostics]);

  return (
    <div className="flex-1 overflow-y-auto bg-bg-primary/50">
      <div className="border-b border-border-primary bg-bg-primary/60 px-5 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigateBackFromRepair()} className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary" title="Назад">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-text-primary">Account Repair Center</h1>
            <p className="text-xs text-text-tertiary">Диагностика аккаунтов, восстановление и privacy-safe debug export</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void load()} disabled={loading}>
              Обновить
            </Button>
            <Button variant="primary" icon={<Download size={14} />} onClick={handleExport} disabled={diagnostics.length === 0}>
              Export debug
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1040px] px-6 py-6">
        {actionError && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {actionError}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-text-tertiary">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-lg border border-border-primary bg-bg-secondary/70 p-6 text-sm text-text-tertiary">
            Аккаунты для диагностики не найдены.
          </div>
        ) : (
          <div className="space-y-5">
            {accounts.map((account) => {
              const accountDiagnostics = diagnosticsByAccount.get(account.id) ?? [];
              const healthy = accountDiagnostics.length === 0;
              return (
                <section key={account.id} className="rounded-lg border border-border-primary bg-bg-secondary/70 p-4">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {healthy ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 text-danger" />}
                        <h2 className="truncate text-sm font-semibold text-text-primary">{account.display_name ?? account.email}</h2>
                        <span className="rounded-full bg-bg-tertiary px-2 py-0.5 text-[0.65rem] font-medium text-text-tertiary">
                          {providerLabel(account)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-text-tertiary">{account.email}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="secondary"
                        size="xs"
                        icon={<RefreshCw size={13} className={actionState[`retry:${account.id}`] === "running" ? "animate-spin" : ""} />}
                        onClick={() => void handleRetry(account.id)}
                        disabled={actionState[`retry:${account.id}`] === "running"}
                      >
                        Retry sync
                      </Button>
                      <Button variant="ghost" size="xs" icon={<Settings size={13} />} onClick={() => navigateToSettings("accounts")}>
                        Settings
                      </Button>
                    </div>
                  </div>

                  {healthy ? (
                    <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">
                      Нет сохранённых ошибок подключения для этого аккаунта.
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {accountDiagnostics.map((diagnostic) => (
                        <article key={`${diagnostic.layer}:${diagnostic.operation}`} className={`rounded-lg border p-3 ${severityClasses(diagnostic)}`}>
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase">
                              <AlertTriangle size={14} />
                              {diagnostic.layer} / {diagnostic.operation}
                            </div>
                            <span className="rounded-full bg-bg-primary/70 px-2 py-0.5 text-[0.65rem]">{diagnostic.retryState}</span>
                          </div>
                          <p className="text-sm font-medium">{diagnostic.userMessage}</p>
                          <dl className="mt-3 grid grid-cols-2 gap-2 text-[0.7rem]">
                            <div><dt className="text-text-tertiary">Reason</dt><dd className="font-medium">{diagnostic.reason}</dd></div>
                            <div><dt className="text-text-tertiary">Debug code</dt><dd className="font-medium">{diagnostic.debugCode}</dd></div>
                            <div><dt className="text-text-tertiary">Updated</dt><dd>{formatTime(diagnostic.updatedAt)}</dd></div>
                            <div><dt className="text-text-tertiary">Retryable</dt><dd>{diagnostic.retryable ? "yes" : "no"}</dd></div>
                          </dl>
                          {diagnostic.rawCause && (
                            <details className="mt-3 text-[0.7rem]">
                              <summary className="cursor-pointer font-medium">Sanitized details</summary>
                              <p className="mt-1 break-words rounded bg-bg-primary/70 p-2 text-text-secondary">{diagnostic.rawCause}</p>
                            </details>
                          )}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {diagnostic.userAction === "reauth" && (
                              <Button size="xs" variant="primary" icon={<KeyRound size={13} />} onClick={() => void handleReauth(account.id)} disabled={actionState[`reauth:${account.id}`] === "running"}>
                                {actionState[`reauth:${account.id}`] === "running" ? "Ожидание..." : actionLabel(diagnostic.userAction)}
                              </Button>
                            )}
                            {(diagnostic.userAction === "retry" || diagnostic.retryable) && (
                              <Button size="xs" variant="secondary" icon={<RefreshCw size={13} />} onClick={() => void handleRetry(account.id)} disabled={actionState[`retry:${account.id}`] === "running"}>
                                Повторить
                              </Button>
                            )}
                            {(diagnostic.userAction === "edit_settings" || diagnostic.userAction === "check_password" || diagnostic.userAction === "check_tls") && (
                              <Button size="xs" variant="secondary" icon={<Wrench size={13} />} onClick={() => navigateToSettings("accounts")}>
                                {actionLabel(diagnostic.userAction)}
                              </Button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
