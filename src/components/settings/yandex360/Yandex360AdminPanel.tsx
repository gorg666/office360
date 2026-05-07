import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Play, Save, ShieldAlert } from "lucide-react";
import { getAllAccounts, type DbAccount } from "@/services/db/accounts";
import {
  executeYandex360Operation,
  getYandex360Credentials,
  saveYandex360Credentials,
  YANDEX360_ENDPOINTS,
  YANDEX360_SCOPES,
  type JsonObject,
  type JsonValue,
  type Yandex360EndpointDefinition,
} from "@/services/yandex360";

const inputClass =
  "w-full px-3 py-2 bg-bg-secondary border border-border-primary rounded-lg text-sm text-text-primary outline-none focus:border-accent transition-colors";
const labelClass = "block text-xs font-medium text-text-secondary mb-1";

const GROUP_LABELS: Record<Yandex360EndpointDefinition["group"], string> = {
  organizations: "Организации",
  users: "Сотрудники",
  groups: "Группы",
  departments: "Подразделения",
  externalContacts: "Внешние контакты",
  domains: "Домены и DNS",
  mailboxes: "Общие ящики",
  mailSettings: "Настройки почты",
  antispam: "Антиспам",
  routing: "Маршрутизация",
  security: "Безопасность",
  serviceApplications: "Сервисные приложения",
  auditLogs: "Аудит-логи",
};

export function Yandex360AdminPanel() {
  const [accounts, setAccounts] = useState<DbAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [saved, setSaved] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Yandex360EndpointDefinition["group"]>("organizations");
  const [endpointId, setEndpointId] = useState("organizations.list");
  const [pathParams, setPathParams] = useState<Record<string, string>>({});
  const [queryJson, setQueryJson] = useState("{}");
  const [bodyJson, setBodyJson] = useState("{}");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);

  const yandexAccounts = accounts.filter((account) => account.oauth_provider === "yandex");
  const endpoint = useMemo(
    () => YANDEX360_ENDPOINTS.find((item) => item.id === endpointId) ?? YANDEX360_ENDPOINTS[0]!,
    [endpointId],
  );
  const endpointsForGroup = useMemo(
    () => YANDEX360_ENDPOINTS.filter((item) => item.group === selectedGroup),
    [selectedGroup],
  );
  const groupedScopes = useMemo(() => {
    const scopes = YANDEX360_SCOPES.filter((scope) => scope.group === selectedGroup);
    return scopes.map((scope) => scope.id).join(" ");
  }, [selectedGroup]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [dbAccounts, credentials] = await Promise.all([
        getAllAccounts(),
        getYandex360Credentials(),
      ]);
      if (cancelled) return;
      setAccounts(dbAccounts);
      setClientId(credentials.clientId);
      setClientSecret(credentials.clientSecret);
      setManualToken(credentials.accessToken);
      const firstYandex = dbAccounts.find((account) => account.oauth_provider === "yandex");
      if (firstYandex) setAccountId(firstYandex.id);
    }
    load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const first = endpointsForGroup[0];
    if (first && first.id !== endpointId) {
      setEndpointId(first.id);
    }
  }, [endpointId, endpointsForGroup]);

  useEffect(() => {
    const nextParams: Record<string, string> = {};
    for (const key of endpoint.pathParams ?? []) {
      nextParams[key] = pathParams[key] ?? "";
    }
    setPathParams(nextParams);
    setBodyJson(endpoint.bodyExample ? JSON.stringify(endpoint.bodyExample, null, 2) : "{}");
    setError(null);
  }, [endpoint.id]);

  const handleSaveCredentials = async () => {
    await saveYandex360Credentials({
      clientId,
      clientSecret,
      accessToken: manualToken,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleRun = async () => {
    setError(null);
    setResult("");

    if (endpoint.risk === "destructive") {
      const confirmed = window.confirm(
        `Операция "${endpoint.label}" может удалить или отозвать данные в Яндекс 360. Продолжить?`,
      );
      if (!confirmed) return;
    }

    try {
      setIsRunning(true);
      const query = parseJsonObject(queryJson, "query");
      const body = endpoint.method === "GET" || endpoint.method === "DELETE"
        ? undefined
        : parseJsonValue(bodyJson, "body");
      const response = await executeYandex360Operation({
        endpointId: endpoint.id,
        accountId: accountId || undefined,
        token: accountId ? undefined : manualToken.trim() || undefined,
        pathParams,
        query: coerceQuery(query),
        body,
      });
      setResult(JSON.stringify(response, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-text-secondary">
        <div className="flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-warning mt-0.5 shrink-0" />
          <p>
            Яндекс 360 API управляет организацией, пользователями, доменами и почтовыми политиками.
            Для операций записи нужны права администратора, корректные OAuth scopes и подходящий тариф.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div>
            <label htmlFor="yandex-account" className={labelClass}>
              Подключенный Яндекс ID аккаунт
            </label>
            <select
              id="yandex-account"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className={inputClass}
            >
              <option value="">Использовать ручной OAuth-токен</option>
              {yandexAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.display_name ?? account.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="yandex-token" className={labelClass}>
              OAuth-токен Яндекс 360
            </label>
            <input
              id="yandex-token"
              type="password"
              value={manualToken}
              onChange={(event) => setManualToken(event.target.value)}
              placeholder="OAuth token, если не выбран Яндекс ID аккаунт"
              className={inputClass}
              disabled={!!accountId}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="yandex-client-id" className={labelClass}>
              Client ID
            </label>
            <input
              id="yandex-client-id"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="ClientID из oauth.yandex.ru"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="yandex-client-secret" className={labelClass}>
              Client Secret
            </label>
            <input
              id="yandex-client-secret"
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder="Опционально для OAuth-приложения"
              className={inputClass}
            />
          </div>
          <button
            type="button"
            onClick={handleSaveCredentials}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary border border-border-primary rounded-lg text-text-primary hover:bg-bg-hover transition-colors"
          >
            <Save className="w-4 h-4" />
            {saved ? "Сохранено" : "Сохранить настройки Яндекса"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        <div className="space-y-1">
          {Object.entries(GROUP_LABELS).map(([group, label]) => (
            <button
              key={group}
              type="button"
              onClick={() => setSelectedGroup(group as Yandex360EndpointDefinition["group"])}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selectedGroup === group
                  ? "bg-accent/10 text-accent"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="yandex-endpoint" className={labelClass}>
              Операция
            </label>
            <select
              id="yandex-endpoint"
              value={endpointId}
              onChange={(event) => setEndpointId(event.target.value)}
              className={inputClass}
            >
              {endpointsForGroup.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.method} {item.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-tertiary mt-1">
              {endpoint.description} Scopes: {endpoint.scopes.join(", ")}
            </p>
          </div>

          <div className="rounded-lg bg-bg-secondary border border-border-primary p-3 text-xs text-text-tertiary">
            <div className="font-mono text-text-secondary">
              {endpoint.method} {endpoint.path}
            </div>
            {groupedScopes && (
              <div className="mt-2">
                Все scopes раздела: <span className="font-mono">{groupedScopes}</span>
              </div>
            )}
            <a
              href={endpoint.documentationUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:text-accent-hover mt-2"
            >
              Документация Яндекса
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {(endpoint.pathParams ?? []).length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {endpoint.pathParams?.map((param) => (
                <div key={param}>
                  <label htmlFor={`path-${param}`} className={labelClass}>
                    {param}
                  </label>
                  <input
                    id={`path-${param}`}
                    value={pathParams[param] ?? ""}
                    onChange={(event) =>
                      setPathParams((prev) => ({ ...prev, [param]: event.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <label htmlFor="yandex-query" className={labelClass}>
              Query JSON
            </label>
            <textarea
              id="yandex-query"
              value={queryJson}
              onChange={(event) => setQueryJson(event.target.value)}
              rows={3}
              className={`${inputClass} font-mono`}
            />
          </div>

          {endpoint.method !== "GET" && endpoint.method !== "DELETE" && (
            <div>
              <label htmlFor="yandex-body" className={labelClass}>
                Body JSON
              </label>
              <textarea
                id="yandex-body"
                value={bodyJson}
                onChange={(event) => setBodyJson(event.target.value)}
                rows={6}
                className={`${inputClass} font-mono`}
              />
            </div>
          )}

          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning || (!accountId && !manualToken.trim())}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="w-4 h-4" />
            {isRunning ? "Выполняется..." : "Выполнить запрос"}
          </button>

          {error && (
            <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-sm text-danger">
              {error}
            </div>
          )}

          {result && (
            <pre className="max-h-96 overflow-auto rounded-lg bg-bg-secondary border border-border-primary p-3 text-xs text-text-primary">
              {result}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function parseJsonValue(raw: string, label: string): JsonValue {
  try {
    return JSON.parse(raw || "null") as JsonValue;
  } catch {
    throw new Error(`${label} должен быть валидным JSON.`);
  }
}

function parseJsonObject(raw: string, label: string): JsonObject {
  const parsed = parseJsonValue(raw, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} должен быть JSON-объектом.`);
  }
  return parsed;
}

function coerceQuery(
  query: JsonObject,
): Record<string, string | number | boolean | null | undefined> {
  const result: Record<string, string | number | boolean | null | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      result[key] = value;
    } else {
      result[key] = JSON.stringify(value);
    }
  }
  return result;
}
