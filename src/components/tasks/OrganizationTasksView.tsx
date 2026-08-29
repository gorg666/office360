import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, Loader2, Mail, RefreshCw, Search } from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { getStoredYandexOrgId } from "@/services/yandex/accountApi";
import { createDefaultTrackerProvider } from "@/services/tasks/mailCreateFlow";
import { SqliteTaskRepository } from "@/services/tasks/taskRepository";
import { TaskService } from "@/services/tasks/taskService";
import type { Task } from "@/services/tasks/domain";
import {
  emptyStateCopyRu,
  formatTaskDueDate,
  isOverdue,
  mailSourceOf,
  priorityDisplayLabel,
  statusDisplayLabel,
  type TaskListSection,
} from "@/services/tasks/taskListView";
import { Button } from "@/components/ui/Button";
import { ProjectedTaskDetailModal } from "./TaskDetailView";
import { TaskPersonCell } from "./TaskPersonCell";

const SECTIONS: { id: TaskListSection; label: string }[] = [
  { id: "my", label: "Мои задачи" },
  { id: "created-by-me", label: "Поставленные мной" },
  { id: "completed", label: "Завершённые" },
];

function buildService(): TaskService {
  const repository = new SqliteTaskRepository();
  return new TaskService(repository, (id) => createDefaultTrackerProvider(id, repository));
}

export function OrganizationTasksView() {
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.isActive);
  const accountId = activeAccount?.id ?? null;
  const userEmail = activeAccount?.email ?? "";

  const [section, setSection] = useState<TaskListSection>("my");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [counts, setCounts] = useState<Partial<Record<TaskListSection, number>>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const [staleHint, setStaleHint] = useState(false);
  const [textQuery, setTextQuery] = useState("");
  const [selected, setSelected] = useState<Task | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [readOnly, setReadOnly] = useState(false);

  const currentUser = useMemo(
    () => ({ email: userEmail, providerUid: null as string | null }),
    [userEmail],
  );

  const loadCached = useCallback(async () => {
    if (!accountId || !userEmail) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const orgId = (await getStoredYandexOrgId(accountId))?.trim() || null;
      setOrganizationId(orgId);
      const service = buildService();
      const listed = await service.listSection({
        organizationId: orgId,
        section,
        currentUser,
        textQuery,
      });
      setTasks(listed);

      const [my, created, completed] = await Promise.all([
        service.listSection({ organizationId: orgId, section: "my", currentUser }),
        service.listSection({ organizationId: orgId, section: "created-by-me", currentUser }),
        service.listSection({ organizationId: orgId, section: "completed", currentUser }),
      ]);
      setCounts({
        my: my.length,
        "created-by-me": created.length,
        completed: completed.length,
      });

      try {
        const provider = createDefaultTrackerProvider(accountId, new SqliteTaskRepository());
        if (orgId) {
          const caps = await provider.capabilities(orgId);
          setReadOnly(caps.read && !caps.create && !caps.transitions);
        }
      } catch {
        /* ignore capability probe */
      }
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [accountId, userEmail, section, textQuery, currentUser]);

  useEffect(() => {
    void loadCached();
  }, [loadCached]);

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      void loadCached();
    };
    window.addEventListener("velo-task-created", handler);
    return () => window.removeEventListener("velo-task-created", handler);
  }, [loadCached]);

  const handleRefresh = useCallback(async () => {
    if (!accountId || !organizationId) return;
    setRefreshing(true);
    setSyncError(null);
    const service = buildService();
    const result = await service.refreshFromProvider({ accountId, organizationId });
    if (!result.ok) {
      setSyncError("Не удалось обновить задачи");
      setStaleHint(true);
    } else {
      setStaleHint(false);
    }
    await loadCached();
    setRefreshing(false);
  }, [accountId, organizationId, loadCached]);

  useEffect(() => {
    setFocusIndex(0);
  }, [section, tasks]);

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (tasks.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIndex((i) => Math.min(i + 1, tasks.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const task = tasks[focusIndex];
      if (task) setSelected(task);
    }
  };

  if (!accountId) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-text-secondary">
        Выберите аккаунт, чтобы видеть задачи
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-bg-primary/50">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border-primary shrink-0 bg-bg-primary/60 backdrop-blur-sm gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CheckSquare size={18} className="text-accent" aria-hidden />
          <h1 className="text-base font-semibold text-text-primary">Задачи</h1>
          {organizationId ? (
            <span className="text-[11px] text-text-tertiary truncate max-w-[160px]" title={organizationId}>
              орг. {organizationId}
            </span>
          ) : (
            <span className="text-[11px] text-warning">организация не выбрана</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden />
            <input
              type="search"
              value={textQuery}
              onChange={(e) => setTextQuery(e.target.value)}
              placeholder="Поиск…"
              aria-label="Поиск задач"
              className="w-44 pl-8 pr-3 py-1.5 bg-bg-tertiary border border-border-primary rounded-lg text-xs text-text-primary outline-none focus:border-accent"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            disabled={refreshing || !organizationId || offline}
            onClick={() => void handleRefresh()}
            aria-label="Обновить задачи"
          >
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            <span className="ml-1">Обновить</span>
          </Button>
        </div>
      </div>

      {(offline || syncError || staleHint || readOnly) && (
        <div className="px-5 py-2 border-b border-border-secondary space-y-1" role="status">
          {offline ? (
            <p className="text-xs text-text-secondary">Офлайн — показаны сохранённые задачи</p>
          ) : null}
          {syncError ? <p className="text-xs text-danger">{syncError}</p> : null}
          {staleHint && !syncError ? (
            <p className="text-xs text-text-tertiary">Список может быть устаревшим</p>
          ) : null}
          {readOnly ? (
            <p className="text-xs text-text-tertiary">Tracker только для чтения</p>
          ) : null}
        </div>
      )}

      <div className="flex gap-1 px-4 py-2 border-b border-border-primary overflow-x-auto" role="tablist" aria-label="Разделы задач">
        {SECTIONS.map((item) => {
          const selectedTab = section === item.id;
          const count = counts[item.id];
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selectedTab}
              onClick={() => setSection(item.id)}
              className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${
                selectedTab
                  ? "bg-accent/15 text-accent font-semibold"
                  : "text-text-secondary hover:bg-bg-tertiary"
              }`}
            >
              {item.label}
              {typeof count === "number" ? (
                <span className="ml-1.5 text-text-tertiary">{count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        className="flex-1 overflow-y-auto py-2 px-3"
        role="listbox"
        aria-label={SECTIONS.find((s) => s.id === section)?.label ?? "Задачи"}
        tabIndex={0}
        onKeyDown={onListKeyDown}
      >
        {loading ? (
          <div className="flex items-center justify-center py-16 text-text-tertiary gap-2 text-sm">
            <Loader2 size={16} className="animate-spin" />
            Загрузка…
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CheckSquare size={48} className="text-text-tertiary/30 mb-4" aria-hidden />
            <p className="text-sm text-text-secondary">{emptyStateCopyRu(section)}</p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {tasks.map((task, index) => {
              const overdue = isOverdue(task);
              const fromMail = Boolean(mailSourceOf(task));
              const focused = index === focusIndex;
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={focused}
                    onClick={() => {
                      setFocusIndex(index);
                      setSelected(task);
                    }}
                    onFocus={() => setFocusIndex(index)}
                    className={`w-full text-left rounded-lg px-3 py-2 border border-transparent hover:bg-bg-tertiary/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      focused ? "bg-bg-tertiary/60" : ""
                    } ${overdue ? "border-l-2 border-l-danger" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-sm truncate ${overdue ? "text-danger font-medium" : "text-text-primary"}`}>
                            {task.title}
                          </span>
                          {fromMail ? (
                            <span
                              className="inline-flex items-center gap-1 shrink-0 text-[10px] text-text-tertiary bg-bg-secondary px-1.5 py-0.5 rounded"
                              title="Из письма"
                            >
                              <Mail size={10} aria-hidden />
                              Из письма
                            </span>
                          ) : null}
                          {overdue ? (
                            <span className="text-[10px] text-danger shrink-0">Просрочена</span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
                          <span>
                            <span className="sr-only">Статус: </span>
                            {statusDisplayLabel(task)}
                          </span>
                          <span>
                            <span className="sr-only">Приоритет: </span>
                            {priorityDisplayLabel(task)}
                          </span>
                          {task.externalKey ? <span>{task.externalKey}</span> : null}
                          <span>срок: {formatTaskDueDate(task.dueAt)}</span>
                        </div>
                      </div>
                      <div className="shrink-0 w-36 hidden md:block">
                        <TaskPersonCell principal={task.assignee} />
                      </div>
                    </div>
                    <div className="mt-1 md:hidden">
                      <TaskPersonCell principal={task.assignee} />
                    </div>
                    <div className="mt-0.5 text-[11px] text-text-tertiary truncate">
                      автор:{" "}
                      {task.createdBy
                        ? (task.createdBy.displayName || task.createdBy.email || "—")
                        : "—"}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ProjectedTaskDetailModal
        task={selected}
        isOpen={Boolean(selected)}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
