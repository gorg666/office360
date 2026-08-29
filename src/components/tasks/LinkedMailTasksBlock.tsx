import { useCallback, useEffect, useState } from "react";
import { ListTodo } from "lucide-react";
import type { Task } from "@/services/tasks/domain";
import { SqliteTaskRepository } from "@/services/tasks/taskRepository";
import { TaskService } from "@/services/tasks/taskService";
import {
  formatTaskDueDate,
  statusDisplayLabel,
} from "@/services/tasks/taskListView";
import { Button } from "@/components/ui/Button";
import { ProjectedTaskDetailModal } from "./TaskDetailView";
import { principalPrimaryLabel } from "./TaskPersonCell";

export interface LinkedMailTasksBlockProps {
  accountId: string;
  messageId: string;
  refreshKey?: number;
}

export function LinkedMailTasksBlock({ accountId, messageId, refreshKey = 0 }: LinkedMailTasksBlockProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [detail, setDetail] = useState<Task | null>(null);

  const load = useCallback(async () => {
    const service = new TaskService(new SqliteTaskRepository());
    const rows = await service.getTasksForMail(accountId, messageId);
    setTasks(rows);
  }, [accountId, messageId]);

  useEffect(() => {
    let cancelled = false;
    void load().catch(() => {
      if (!cancelled) setTasks([]);
    });
    const onUpdated = () => {
      void load();
    };
    window.addEventListener("velo-task-created", onUpdated);
    window.addEventListener("velo-task-updated", onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("velo-task-created", onUpdated);
      window.removeEventListener("velo-task-updated", onUpdated);
    };
  }, [load, refreshKey]);

  if (tasks.length === 0) return null;

  return (
    <div className="mx-6 my-3 rounded-md border border-border-primary bg-bg-secondary/60 px-3 py-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-text-primary mb-2">
        <ListTodo size={13} aria-hidden />
        Задачи из этого письма
      </div>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-start justify-between gap-2 text-xs">
            <div className="min-w-0">
              <div className="text-sm text-text-primary truncate">{task.title}</div>
              <div className="text-text-tertiary truncate">
                {principalPrimaryLabel(task.assignee)} · {formatTaskDueDate(task.dueAt)} ·{" "}
                {statusDisplayLabel(task)}
                {task.externalKey ? ` · ${task.externalKey}` : ""}
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => setDetail(task)}
            >
              Открыть
            </Button>
          </li>
        ))}
      </ul>

      <ProjectedTaskDetailModal
        task={detail}
        isOpen={Boolean(detail)}
        onClose={() => setDetail(null)}
        accountId={accountId}
        onTaskUpdated={(task) => {
          setDetail(task);
          void load();
        }}
      />
    </div>
  );
}
