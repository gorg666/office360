import { useState, useEffect, useCallback, useMemo } from "react";
import {
  CheckSquare,
  Search,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { useTaskStore, type TaskGroupBy, type TaskFilterStatus } from "@/stores/taskStore";
import {
  getTasksForAccount,
  insertTask,
  completeTask,
  uncompleteTask,
  deleteTask as dbDeleteTask,
  getSubtasks,
  getIncompleteTaskCount,
  type DbTask,
  type TaskPriority,
} from "@/services/db/tasks";
import { handleRecurringTaskCompletion } from "@/services/tasks/taskManager";
import { TaskItem } from "./TaskItem";
import { TaskQuickAdd } from "./TaskQuickAdd";
import { TaskDetailModal } from "./TaskDetailModal";
import { useUIStore } from "@/stores/uiStore";

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export function TasksPage() {
  const locale = useUIStore((state) => state.locale);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.isActive);
  const accountId = activeAccount?.id ?? null;

  const tasks = useTaskStore((s) => s.tasks);
  const setTasks = useTaskStore((s) => s.setTasks);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useTaskStore((s) => s.setSelectedTaskId);
  const groupBy = useTaskStore((s) => s.groupBy);
  const setGroupBy = useTaskStore((s) => s.setGroupBy);
  const filterStatus = useTaskStore((s) => s.filterStatus);
  const setFilterStatus = useTaskStore((s) => s.setFilterStatus);
  const filterPriority = useTaskStore((s) => s.filterPriority);
  const setFilterPriority = useTaskStore((s) => s.setFilterPriority);
  const searchQuery = useTaskStore((s) => s.searchQuery);
  const setSearchQuery = useTaskStore((s) => s.setSearchQuery);

  const [subtaskMap, setSubtaskMap] = useState<Record<string, DbTask[]>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Load tasks
  const loadTasks = useCallback(async () => {
    if (!accountId) return;
    const includeCompleted = filterStatus !== "incomplete";
    const loaded = await getTasksForAccount(accountId, includeCompleted);
    setTasks(loaded);
    const count = await getIncompleteTaskCount(accountId);
    useTaskStore.getState().setIncompleteCount(count);
  }, [accountId, filterStatus, setTasks]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Load subtasks
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const map: Record<string, DbTask[]> = {};
      for (const task of tasks) {
        const subs = await getSubtasks(task.id);
        if (subs.length > 0) map[task.id] = subs;
      }
      if (!cancelled) setSubtaskMap(map);
    }
    load();
    return () => { cancelled = true; };
  }, [tasks]);

  // Filter + search
  const filteredTasks = useMemo(() => {
    let result = tasks;

    if (filterStatus === "completed") {
      result = result.filter((t) => t.is_completed);
    } else if (filterStatus === "incomplete") {
      result = result.filter((t) => !t.is_completed);
    }

    if (filterPriority !== "all") {
      result = result.filter((t) => t.priority === filterPriority);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) => t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q),
      );
    }

    return result;
  }, [tasks, filterStatus, filterPriority, searchQuery]);

  // Grouping
  const groupedTasks = useMemo(() => {
    if (groupBy === "none") return [{ label: "", tasks: filteredTasks }];

    const groups = new Map<string, DbTask[]>();

    for (const task of filteredTasks) {
      let key: string;
      switch (groupBy) {
        case "priority":
          key = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
          break;
        case "dueDate":
          if (!task.due_date) key = "No due date";
          else {
            const d = new Date(task.due_date * 1000);
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const dueStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const diff = Math.floor((dueStart.getTime() - todayStart.getTime()) / 86400000);
            if (diff < 0) key = locale === "ru" ? "Просрочено" : "Overdue";
            else if (diff === 0) key = locale === "ru" ? "Сегодня" : "Today";
            else if (diff === 1) key = locale === "ru" ? "Завтра" : "Tomorrow";
            else if (diff <= 7) key = locale === "ru" ? "На этой неделе" : "This week";
            else key = locale === "ru" ? "Позже" : "Later";
          }
          break;
        case "tag": {
          const tags: string[] = (() => { try { return JSON.parse(task.tags_json); } catch { return []; } })();
          key = tags[0] ?? (locale === "ru" ? "Без тегов" : "Untagged");
          break;
        }
        default:
          key = "";
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(task);
    }

    // Sort groups by priority order if grouping by priority
    const entries = [...groups.entries()];
    if (groupBy === "priority") {
      entries.sort((a, b) => {
        const aP = PRIORITY_ORDER[a[0].toLowerCase() as TaskPriority] ?? 99;
        const bP = PRIORITY_ORDER[b[0].toLowerCase() as TaskPriority] ?? 99;
        return aP - bP;
      });
    }

    return entries.map(([label, tasks]) => ({ label, tasks }));
  }, [filteredTasks, groupBy, locale]);

  const statusLabels: Record<TaskFilterStatus, string> = locale === "ru"
    ? { incomplete: "Активные", all: "Все", completed: "Завершённые" }
    : { incomplete: "Active", all: "All", completed: "Completed" };
  const priorityLabels: Record<TaskPriority | "all", string> = locale === "ru"
    ? {
      all: "Все приоритеты",
      urgent: "Срочно",
      high: "Высокий",
      medium: "Средний",
      low: "Низкий",
      none: "Без приоритета",
    }
    : {
      all: "All priorities",
      urgent: "Urgent",
      high: "High",
      medium: "Medium",
      low: "Low",
      none: "None",
    };
  const groupLabels: Record<TaskGroupBy, string> = locale === "ru"
    ? {
      none: "Без группировки",
      priority: "Группировать по приоритету",
      dueDate: "Группировать по сроку",
      tag: "Группировать по тегу",
    }
    : {
      none: "No grouping",
      priority: "Group by priority",
      dueDate: "Group by due date",
      tag: "Group by tag",
    };

  const handleAddTask = useCallback(async (title: string) => {
    if (!accountId) return;
    await insertTask({ accountId, title });
    await loadTasks();
  }, [accountId, loadTasks]);

  const handleToggleComplete = useCallback(async (id: string, completed: boolean) => {
    if (completed) {
      const task = tasks.find((t) => t.id === id);
      if (task?.recurrence_rule) {
        await handleRecurringTaskCompletion(id);
      } else {
        await completeTask(id);
      }
    } else {
      await uncompleteTask(id);
    }
    await loadTasks();
  }, [tasks, loadTasks]);

  const handleDelete = useCallback(async (id: string) => {
    await dbDeleteTask(id);
    if (selectedTaskId === id) setSelectedTaskId(null);
    await loadTasks();
  }, [loadTasks, selectedTaskId, setSelectedTaskId]);

  const handleBulkComplete = useCallback(async () => {
    for (const id of selectedIds) {
      await completeTask(id);
    }
    setSelectedIds(new Set());
    await loadTasks();
  }, [selectedIds, loadTasks]);

  const handleBulkDelete = useCallback(async () => {
    for (const id of selectedIds) {
      await dbDeleteTask(id);
    }
    setSelectedIds(new Set());
    if (selectedTaskId && selectedIds.has(selectedTaskId)) setSelectedTaskId(null);
    await loadTasks();
  }, [selectedIds, loadTasks, selectedTaskId, setSelectedTaskId]);

  const selectedTask = selectedTaskId
    ? tasks.find((task) => task.id === selectedTaskId) ?? null
    : null;

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-bg-primary/50">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border-primary shrink-0 bg-bg-primary/60 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <CheckSquare size={18} className="text-accent" />
          <h1 className="text-base font-semibold text-text-primary">
            {locale === "ru" ? "Задачи" : "Tasks"}
          </h1>
          {filteredTasks.length > 0 && (
            <span className="text-xs text-text-tertiary bg-bg-tertiary px-2 py-0.5 rounded-full">
              {filteredTasks.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={locale === "ru" ? "Поиск задач..." : "Search tasks..."}
              className="w-48 pl-8 pr-3 py-1.5 bg-bg-tertiary border border-border-primary rounded-lg text-xs text-text-primary outline-none focus:border-accent"
            />
          </div>

          {/* Filters */}
          <select
            value={filterStatus}
            title={locale === "ru" ? "Фильтр статуса задач" : "Task status filter"}
            onChange={(e) => setFilterStatus(e.target.value as TaskFilterStatus)}
            className="bg-bg-tertiary text-text-primary text-xs px-2.5 py-1.5 rounded-lg border border-border-primary"
          >
            <option value="incomplete">{statusLabels.incomplete}</option>
            <option value="all">{statusLabels.all}</option>
            <option value="completed">{statusLabels.completed}</option>
          </select>

          <select
            value={filterPriority}
            title={locale === "ru" ? "Фильтр приоритета задач" : "Task priority filter"}
            onChange={(e) => setFilterPriority(e.target.value as TaskPriority | "all")}
            className="bg-bg-tertiary text-text-primary text-xs px-2.5 py-1.5 rounded-lg border border-border-primary"
          >
            <option value="all">{priorityLabels.all}</option>
            <option value="urgent">{priorityLabels.urgent}</option>
            <option value="high">{priorityLabels.high}</option>
            <option value="medium">{priorityLabels.medium}</option>
            <option value="low">{priorityLabels.low}</option>
            <option value="none">{priorityLabels.none}</option>
          </select>

          {/* Group by */}
          <select
            value={groupBy}
            title={locale === "ru" ? "Группировка задач" : "Task grouping"}
            onChange={(e) => setGroupBy(e.target.value as TaskGroupBy)}
            className="bg-bg-tertiary text-text-primary text-xs px-2.5 py-1.5 rounded-lg border border-border-primary"
          >
            <option value="none">{groupLabels.none}</option>
            <option value="priority">{groupLabels.priority}</option>
            <option value="dueDate">{groupLabels.dueDate}</option>
            <option value="tag">{groupLabels.tag}</option>
          </select>
        </div>
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-5 py-2 bg-accent/5 border-b border-accent/20">
          <span className="text-xs text-text-secondary">
            {locale === "ru" ? `Выбрано: ${selectedIds.size}` : `${selectedIds.size} selected`}
          </span>
          <button
            onClick={handleBulkComplete}
            className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
          >
            <CheckCircle2 size={13} />
            {locale === "ru" ? "Завершить" : "Complete"}
          </button>
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1 text-xs text-danger hover:opacity-80"
          >
            <Trash2 size={13} />
            {locale === "ru" ? "Удалить" : "Delete"}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-text-tertiary hover:text-text-primary ml-auto"
          >
            {locale === "ru" ? "Снять выделение" : "Clear selection"}
          </button>
        </div>
      )}

      {/* Quick add */}
      <div className="border-b border-border-primary px-2">
        <TaskQuickAdd onAdd={handleAddTask} />
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto py-2 px-3">
        {filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CheckSquare size={48} className="text-text-tertiary/30 mb-4" />
            <p className="text-sm text-text-secondary mb-1">
              {locale === "ru" ? "Нет задач" : "No tasks"}
            </p>
            <p className="text-xs text-text-tertiary">
              {searchQuery
                ? (locale === "ru" ? "Попробуйте другой поисковый запрос" : "Try a different search term")
                : (locale === "ru" ? "Добавьте задачу выше или нажмите 't' в любой цепочке писем" : "Add a task above or press 't' on any email thread")
              }
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedTasks.map((group) => (
              <div key={group.label || "__ungrouped"}>
                {group.label && (
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2 px-3">
                    {group.label}
                  </h3>
                )}
                <div className="space-y-0.5">
                  {group.tasks.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      subtasks={subtaskMap[task.id]}
                      onToggleComplete={handleToggleComplete}
                      onSelect={setSelectedTaskId}
                      onDelete={handleDelete}
                      isSelected={selectedTaskId === task.id}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {selectedTask ? (
        <TaskDetailModal
          key={selectedTask.id}
          task={selectedTask}
          accountId={accountId}
          onClose={() => setSelectedTaskId(null)}
          onSaved={loadTasks}
        />
      ) : null}
    </div>
  );
}
