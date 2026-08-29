import { useCallback, useEffect, useState } from "react";
import { CheckSquare, Loader2, RefreshCw } from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { getStoredYandexOrgId } from "@/services/yandex/accountApi";
import {
  getOrganizationTaskSettings,
  upsertOrganizationTaskSettings,
} from "@/services/tasks/organizationTaskSettings";
import { createDefaultTrackerProvider } from "@/services/tasks/mailCreateFlow";
import { SqliteTaskRepository } from "@/services/tasks/taskRepository";
import type { OrganizationTaskSettings } from "@/services/tasks/domain";
import type { TaskProviderCapabilities } from "@/services/tasks/taskProvider";
import { Button } from "@/components/ui/Button";
import { isTaskError } from "@/services/tasks/yandexTracker/errors";

interface QueueOption {
  id: string;
  key: string;
  displayName: string;
}

export function TasksSettingsPanel() {
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.isActive);
  const accountId = activeAccount?.id ?? null;

  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [settings, setSettings] = useState<OrganizationTaskSettings | null>(null);
  const [queues, setQueues] = useState<QueueOption[]>([]);
  const [caps, setCaps] = useState<TaskProviderCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const [enabled, setEnabled] = useState(true);
  const [defaultQueue, setDefaultQueue] = useState("");
  const [savedHint, setSavedHint] = useState(false);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const load = useCallback(async () => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const orgId = (await getStoredYandexOrgId(accountId))?.trim() || null;
      setOrganizationId(orgId);
      if (!orgId) {
        setSettings(null);
        setCaps(null);
        setQueues([]);
        return;
      }
      const existing = await getOrganizationTaskSettings(orgId, "yandex-tracker");
      setSettings(existing);
      setEnabled(existing?.enabled ?? true);
      setDefaultQueue(existing?.defaultQueue ?? "");

      const provider = createDefaultTrackerProvider(accountId, new SqliteTaskRepository());
      try {
        setCaps(await provider.capabilities(orgId));
      } catch {
        setCaps(null);
      }
    } catch (e) {
      setError(isTaskError(e) ? e.message : "Не удалось загрузить настройки задач");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const discoverQueues = async () => {
    if (!accountId || !organizationId || offline) return;
    setDiscovering(true);
    setError(null);
    try {
      const provider = createDefaultTrackerProvider(accountId, new SqliteTaskRepository());
      const list = await provider.listQueues(organizationId);
      setQueues(list);
      if (defaultQueue && !list.some((q) => q.key === defaultQueue)) {
        setError("Сохранённая очередь больше недоступна — выберите другую");
      }
    } catch (e) {
      setQueues([]);
      setError(
        isTaskError(e) && e.code === "permission-denied"
          ? "Нет доступа к очередям Tracker"
          : "Не удалось загрузить очереди Tracker",
      );
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    if (organizationId && !offline) void discoverQueues();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load queues when org ready
  }, [organizationId, offline]);

  const save = async () => {
    if (!organizationId) return;
    setSaving(true);
    setError(null);
    setSavedHint(false);
    try {
      const now = Math.floor(Date.now() / 1000);
      const next: OrganizationTaskSettings = {
        organizationId,
        provider: "yandex-tracker",
        enabled,
        providerOrganizationId: settings?.providerOrganizationId ?? organizationId,
        defaultQueue: defaultQueue.trim() || null,
        updatedAt: now,
      };
      await upsertOrganizationTaskSettings(next);
      setSettings(next);
      setSavedHint(true);
    } catch {
      setError("Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  };

  if (!accountId) {
    return <p className="text-sm text-text-secondary">Выберите аккаунт</p>;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Загрузка…
      </div>
    );
  }

  const writeOk = Boolean(caps?.create || caps?.transitions || caps?.assign);
  const readOk = Boolean(caps?.read);

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center gap-2 text-text-primary">
        <CheckSquare size={16} className="text-accent" aria-hidden />
        <h3 className="text-sm font-semibold">Задачи · Yandex Tracker</h3>
      </div>

      {offline ? (
        <p className="text-xs text-warning" role="status">
          Офлайн: кэш задач доступен, discovery очередей и сохранение remote недоступны
        </p>
      ) : null}

      {!organizationId ? (
        <p className="text-sm text-warning" role="status">
          Организация Яндекс 360 не выбрана. Укажите org в разделе «Яндекс 360».
        </p>
      ) : (
        <>
          <div className="grid gap-2 text-xs text-text-secondary">
            <div>
              <span className="text-text-tertiary">Организация: </span>
              <span className="text-text-primary font-mono">{organizationId}</span>
            </div>
            <div>
              <span className="text-text-tertiary">Провайдер: </span>
              <span className="text-text-primary">Yandex Tracker</span>
            </div>
            <div>
              <span className="text-text-tertiary">Tracker: </span>
              <span className="text-text-primary">{readOk ? "доступен" : "недоступен / нет read"}</span>
            </div>
            <div>
              <span className="text-text-tertiary">Права записи: </span>
              <span className="text-text-primary">
                {writeOk ? "есть (tracker:write)" : "только чтение — создание и переходы отключены"}
              </span>
            </div>
            <div>
              <span className="text-text-tertiary">Directory: </span>
              <span className="text-text-primary">
                {caps?.organizationDirectoryBinding
                  ? "резолв участников доступен"
                  : "резолв участников ограничен"}
              </span>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={offline}
            />
            Задачи включены для организации
          </label>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="tasks-default-queue" className="text-xs text-text-tertiary">
                Очередь по умолчанию
              </label>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={offline || discovering}
                onClick={() => void discoverQueues()}
                aria-label="Обновить список очередей"
              >
                {discovering ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              </Button>
            </div>
            <select
              id="tasks-default-queue"
              value={defaultQueue}
              disabled={offline || discovering}
              onChange={(e) => setDefaultQueue(e.target.value)}
              className="w-full bg-bg-tertiary text-text-primary text-sm px-3 py-1.5 rounded-md border border-border-primary focus:border-accent outline-none"
              aria-label="Очередь Tracker по умолчанию"
            >
              <option value="">— не выбрана —</option>
              {queues.map((q) => (
                <option key={q.id || q.key} value={q.key}>
                  {q.displayName} ({q.key})
                </option>
              ))}
              {defaultQueue && !queues.some((q) => q.key === defaultQueue) ? (
                <option value={defaultQueue}>{defaultQueue} (сохранено)</option>
              ) : null}
            </select>
            <p className="text-[11px] text-text-tertiary">
              Office360 не создаёт очереди Tracker — только выбирает существующую.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={offline || saving}
              onClick={() => void save()}
            >
              {saving ? "Сохранение…" : "Сохранить"}
            </Button>
            {savedHint ? (
              <span className="text-xs text-success" role="status">Сохранено</span>
            ) : null}
          </div>
        </>
      )}

      {error ? (
        <p className="text-xs text-danger" role="alert">{error}</p>
      ) : null}

      <p className="text-[11px] text-text-tertiary">
        В настройках хранятся только organization id, provider org id, очередь и флаг enabled.
        OAuth-токены здесь не сохраняются.
      </p>
    </div>
  );
}
