import { useCallback, useEffect, useState } from "react";
import { ExternalLink, ListTodo } from "lucide-react";
import type { Task } from "@/services/tasks/domain";
import { SqliteTaskRepository } from "@/services/tasks/taskRepository";
import { TaskService } from "@/services/tasks/taskService";
import { personDisplayName } from "@/services/people/domain";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

const STATUS_LABEL: Record<Task["status"], string> = {
  open: "Открыта",
  in_progress: "В работе",
  done: "Готово",
  cancelled: "Отменена",
  unknown: "Статус",
};

const PRIORITY_LABEL: Record<Task["priority"], string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  critical: "Критический",
  unknown: "—",
};

function formatDue(dueAt: number | null): string {
  if (dueAt == null) return "без срока";
  return new Date(dueAt * 1000).toLocaleDateString("ru-RU");
}

function assigneeLabel(task: Task): string {
  if (!task.assignee) return "не назначен";
  if (task.assignee.person) return personDisplayName(task.assignee.person);
  return task.assignee.displayName || task.assignee.email || "не назначен";
}

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
    return () => { cancelled = true; };
  }, [load, refreshKey]);

  if (tasks.length === 0) return null;

  return (
    <div className="mx-6 my-3 rounded-md border border-border-primary bg-bg-secondary/60 px-3 py-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-text-primary mb-2">
        <ListTodo size={13} />
        Задачи из этого письма
      </div>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-start justify-between gap-2 text-xs">
            <div className="min-w-0">
              <div className="text-sm text-text-primary truncate">{task.title}</div>
              <div className="text-text-tertiary truncate">
                {assigneeLabel(task)} · {formatDue(task.dueAt)} ·{" "}
                {task.providerStatus?.displayLabel
                  ?? STATUS_LABEL[task.status]}
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

      <Modal
        isOpen={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.title ?? "Задача"}
        width="w-full max-w-md"
      >
        {detail && (
          <div className="p-4 space-y-2 text-sm text-text-secondary">
            <div><span className="text-text-tertiary">Исполнитель:</span> {assigneeLabel(detail)}</div>
            <div><span className="text-text-tertiary">Срок:</span> {formatDue(detail.dueAt)}</div>
            <div><span className="text-text-tertiary">Приоритет:</span> {PRIORITY_LABEL[detail.priority]}</div>
            <div>
              <span className="text-text-tertiary">Статус:</span>{" "}
              {detail.providerStatus?.displayLabel ?? STATUS_LABEL[detail.status]}
            </div>
            {detail.externalKey && (
              <div className="flex items-center gap-2">
                <span className="text-text-tertiary">Ключ:</span> {detail.externalKey}
                <a
                  className="inline-flex items-center gap-1 text-accent hover:underline text-xs"
                  href={`https://tracker.yandex.ru/${encodeURIComponent(detail.externalKey)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Tracker <ExternalLink size={11} />
                </a>
              </div>
            )}
            {detail.description && (
              <p className="pt-2 text-text-primary whitespace-pre-wrap border-t border-border-secondary">
                {detail.description}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
