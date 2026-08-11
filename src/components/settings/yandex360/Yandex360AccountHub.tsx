import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  KeyRound,
  Mail,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { navigateToRepairCenter } from "@/router/navigate";
import { getAllAccounts, type DbAccount } from "@/services/db/accounts";
import { listAccountDiagnostics } from "@/services/db/accountDiagnostics";
import type { ConnectionDiagnostic } from "@/services/diagnostics";
import {
  buildYandex360WorkAccountStatuses,
  type Yandex360ServiceId,
  type Yandex360ServiceReadiness,
  type Yandex360ServiceStatus,
} from "@/services/yandex360";
import {
  authorizeYandexGrant,
  authorizeYandexSuite,
  getYandexUnifiedAuthStatus,
  type YandexOAuthGrant,
  type YandexOAuthGrantStatus,
} from "@/services/oauth/yandexUnifiedAuth";

const statusClasses: Record<Yandex360ServiceStatus, string> = {
  available: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  needs_scope: "border-warning/30 bg-warning/10 text-warning",
  needs_reauth: "border-danger/30 bg-danger/10 text-danger",
  limited: "border-warning/30 bg-warning/10 text-warning",
};

const statusLabels: Record<Yandex360ServiceStatus, string> = {
  available: "Готово",
  needs_scope: "Нужны права",
  needs_reauth: "Нужен вход",
  limited: "Ограничено",
};

const serviceIcons: Record<Yandex360ServiceId, typeof Mail> = {
  mail: Mail,
  calendar: CalendarDays,
  messenger: MessageSquare,
  tracker: CheckSquare,
};

export function Yandex360AccountHub() {
  const [accounts, setAccounts] = useState<DbAccount[]>([]);
  const [diagnostics, setDiagnostics] = useState<ConnectionDiagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [dbAccounts, dbDiagnostics] = await Promise.all([
          getAllAccounts(),
          listAccountDiagnostics(),
        ]);
        if (cancelled) return;
        setAccounts(dbAccounts);
        setDiagnostics(dbDiagnostics);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const yandexStatuses = useMemo(
    () => buildYandex360WorkAccountStatuses(accounts, diagnostics),
    [accounts, diagnostics],
  );

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text-primary">Рабочий аккаунт Яндекс 360</h3>
            <p className="mt-1 text-sm text-text-secondary">
              Подключите почту Яндекс 360 через Яндекс ID. Для обычной работы с почтой и календарем права
              администратора организации не нужны.
            </p>
          </div>
        </div>
      </div>

      {loading && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 text-sm text-text-secondary">
          Загружаем подключенные Яндекс ID аккаунты...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {!loading && !error && yandexStatuses.length === 0 && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text-primary">Яндекс 360 аккаунт не подключен</h3>
              <p className="mt-1 text-sm text-text-secondary">
                Добавьте почтовый аккаунт через Яндекс ID. Для почты нужны разрешения{" "}
                <code className="text-accent">mail:imap_full</code> и{" "}
                <code className="text-accent">mail:smtp</code>; календарь подключается через CalDAV.
              </p>
            </div>
          </div>
        </div>
      )}

      {yandexStatuses.map((status) => (
        <div key={status.account.id} className="rounded-lg border border-border-primary bg-bg-secondary p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-text-primary">{status.displayName}</h3>
              <p className="truncate text-xs text-text-tertiary">{status.email}</p>
              {!status.scopeGrantKnown && (
                <p className="mt-2 text-xs text-text-tertiary">
                  Для старого подключения сохраненный список разрешений неизвестен. Повторный вход обновит статус сервисов.
                </p>
              )}
              {status.limitationMessage && (
                <p className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-xs text-warning">
                  {status.limitationMessage}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => navigateToRepairCenter(status.account.id)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-primary bg-bg-tertiary px-3 py-2 text-sm text-text-primary transition-colors hover:bg-bg-hover"
            >
              <Wrench className="h-4 w-4" />
              Исправить
            </button>
          </div>

          <UnifiedAuthPanel accountId={status.account.id} />

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {status.services.map((service) => (
              <ServiceCard key={service.id} service={service} accountId={status.account.id} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const grantStatusUi: Record<YandexOAuthGrantStatus["statusLabel"], string> = {
  CONNECTED: "CONNECTED",
  "NEEDS ACCESS": "NEEDS ACCESS",
  ERROR: "ERROR",
};

function UnifiedAuthPanel({ accountId }: { accountId: string }) {
  const [grants, setGrants] = useState<YandexOAuthGrantStatus[]>([]);
  const [busy, setBusy] = useState<"suite" | Exclude<YandexOAuthGrant, "core"> | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setGrants(await getYandexUnifiedAuthStatus(accountId));
  }, [accountId]);

  useEffect(() => {
    void reload().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [reload]);

  const connectSuite = async () => {
    setBusy("suite");
    setError(null);
    try {
      const results = await authorizeYandexSuite(accountId, {
        grants: ["work", "communications"],
        continueOnError: true,
        onProgress: ({ label, state }) => setProgress(
          state === "authorizing"
            ? `Подключаем «${label}»…`
            : `«${label}» ${state === "connected" ? "подключён" : "не подключён"}`,
        ),
      });
      const failed = results.filter((result) => result.state === "failed");
      if (failed.length) {
        setError(failed.map((result) => `${result.label}: ${result.error}`).join("\n"));
      }
      await reload();
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const connectGrant = async (grant: Exclude<YandexOAuthGrant, "core">) => {
    setBusy(grant);
    setError(null);
    setProgress(`Подключаем «${grants.find((item) => item.id === grant)?.label ?? grant}»…`);
    try {
      await authorizeYandexGrant(accountId, grant);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-border-primary bg-bg-primary p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-text-primary">Единая авторизация Яндекс ID</h4>
          <p className="mt-1 text-xs text-text-tertiary">
            Прогрессивный доступ: основное, Диск и Трекер, Мессенджер и Телемост, администрирование.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={connectSuite}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-primary bg-bg-tertiary px-2.5 py-1.5 text-xs text-text-primary disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy === "suite" ? "animate-spin" : ""}`} />
            Подключить сервисы
          </button>
          <button
            type="button"
            onClick={() => void connectGrant("admin")}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-primary bg-bg-tertiary px-2.5 py-1.5 text-xs text-text-primary disabled:opacity-50"
          >
            <KeyRound className="h-3.5 w-3.5" />
            Права администратора
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {grants.map((grant) => (
          <div key={grant.id} className="rounded-md border border-border-primary px-2.5 py-2">
            <div className="text-xs font-medium text-text-primary">{grant.label}</div>
            <div className={`mt-1 text-[11px] ${grant.connected ? "text-emerald-700" : "text-text-tertiary"}`}>
              {grantStatusUi[grant.statusLabel]}
            </div>
            {grant.id !== "core" ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void connectGrant(grant.id as Exclude<YandexOAuthGrant, "core">)}
                className="mt-2 text-[11px] text-accent hover:underline disabled:opacity-50"
              >
                {grant.connected ? "Обновить доступ" : "Выдать доступ"}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {progress && <p className="mt-2 text-xs text-accent">{progress}</p>}
      {error && <p className="mt-2 whitespace-pre-line text-xs text-danger">{error}</p>}
    </div>
  );
}

function ServiceCard({ service, accountId }: { service: Yandex360ServiceReadiness; accountId: string }) {
  const Icon = serviceIcons[service.id];
  return (
    <div className="rounded-lg border border-border-primary bg-bg-primary p-3">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-bg-tertiary p-2 text-text-secondary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium text-text-primary">{service.label}</h4>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClasses[service.status]}`}>
              {statusLabels[service.status]}
            </span>
          </div>
          <p className="mt-1 text-sm text-text-secondary">{service.summary}</p>
          <p className="mt-1 text-xs text-text-tertiary">{service.detail}</p>
          {service.missingScopes.length > 0 && (
            <p className="mt-2 text-xs text-text-tertiary">
              Не хватает разрешений: <span className="font-mono text-accent">{service.missingScopes.join(" ")}</span>
            </p>
          )}
          {service.status === "available" && (
            <div className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Сервис готов
            </div>
          )}
          {(service.action === "reauth" || service.action === "open_repair") && (
            <button
              type="button"
              onClick={() => navigateToRepairCenter(accountId)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border-primary bg-bg-tertiary px-2.5 py-1.5 text-xs text-text-primary transition-colors hover:bg-bg-hover"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {service.action === "reauth" ? "Обновить вход" : "Открыть восстановление"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
