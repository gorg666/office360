import { useId, useState } from "react";
import { ExternalLink, Mail } from "lucide-react";
import type { Task } from "@/services/tasks/domain";
import {
  formatTaskDueDate,
  mailSourceOf,
  priorityDisplayLabel,
  statusDisplayLabel,
} from "@/services/tasks/taskListView";
import {
  OPEN_SOURCE_MAIL_COPY,
  openTaskSourceMail,
} from "@/services/tasks/openTaskSourceMail";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { TaskPersonCell, principalPrimaryLabel } from "./TaskPersonCell";

function formatTs(unix: number): string {
  return new Date(unix * 1000).toLocaleString("ru-RU");
}

export interface TaskDetailViewProps {
  task: Task;
  onOpenMailDone?: () => void;
}

export function TaskDetailView({ task, onOpenMailDone }: TaskDetailViewProps) {
  const mailSource = mailSourceOf(task);
  const [mailError, setMailError] = useState<string | null>(null);
  const [openingMail, setOpeningMail] = useState(false);

  const handleOpenMail = async () => {
    setMailError(null);
    setOpeningMail(true);
    try {
      const result = await openTaskSourceMail(task);
      if (!result.ok) {
        setMailError(OPEN_SOURCE_MAIL_COPY[result.reason]);
        return;
      }
      onOpenMailDone?.();
    } catch {
      setMailError(OPEN_SOURCE_MAIL_COPY.missing);
    } finally {
      setOpeningMail(false);
    }
  };

  return (
    <div className="p-4 space-y-3 text-sm text-text-secondary max-h-[70vh] overflow-y-auto">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {task.externalKey ? (
          <div>
            <span className="text-text-tertiary">Ключ: </span>
            <span className="text-text-primary font-medium">{task.externalKey}</span>
            <a
              className="ml-2 inline-flex items-center gap-1 text-accent hover:underline"
              href={`https://tracker.yandex.ru/${encodeURIComponent(task.externalKey)}`}
              target="_blank"
              rel="noreferrer"
            >
              Tracker <ExternalLink size={11} aria-hidden />
            </a>
          </div>
        ) : null}
        <div>
          <span className="text-text-tertiary">Статус: </span>
          <span className="text-text-primary">{statusDisplayLabel(task)}</span>
          {task.providerStatus?.displayLabel
            && task.providerStatus.displayLabel !== statusDisplayLabel(task) ? (
            <span className="text-text-tertiary"> ({task.providerStatus.displayLabel})</span>
          ) : null}
        </div>
        <div>
          <span className="text-text-tertiary">Приоритет: </span>
          <span className="text-text-primary">{priorityDisplayLabel(task)}</span>
        </div>
        <div>
          <span className="text-text-tertiary">Срок: </span>
          <span className="text-text-primary">{formatTaskDueDate(task.dueAt)}</span>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <div className="text-xs text-text-tertiary mb-1">Исполнитель</div>
          <TaskPersonCell principal={task.assignee} compact={false} />
        </div>
        <div>
          <div className="text-xs text-text-tertiary mb-1">Автор</div>
          <TaskPersonCell principal={task.createdBy} compact={false} />
        </div>
      </div>

      {task.followers.length > 0 ? (
        <div>
          <div className="text-xs text-text-tertiary mb-1">Наблюдатели</div>
          <ul className="space-y-1">
            {task.followers.map((follower, index) => (
              <li key={`${follower.email}-${follower.providerUid ?? index}`}>
                <TaskPersonCell principal={follower} compact />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {task.description ? (
        <div className="pt-2 border-t border-border-secondary">
          <div className="text-xs text-text-tertiary mb-1">Описание</div>
          <p className="text-text-primary whitespace-pre-wrap">{task.description}</p>
        </div>
      ) : null}

      {mailSource ? (
        <div
          className="rounded-md border border-border-primary bg-bg-secondary/50 p-3 space-y-2"
          aria-label="Создано из письма"
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
            <Mail size={13} aria-hidden />
            Создано из письма
          </div>
          {mailSource.subjectSnapshot ? (
            <div className="text-xs">
              <span className="text-text-tertiary">Тема: </span>
              <span className="text-text-primary">{mailSource.subjectSnapshot}</span>
            </div>
          ) : null}
          {mailSource.senderSnapshot ? (
            <div className="text-xs">
              <span className="text-text-tertiary">От: </span>
              <span className="text-text-primary">{mailSource.senderSnapshot}</span>
            </div>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="xs"
            disabled={openingMail}
            onClick={() => void handleOpenMail()}
          >
            Открыть письмо
          </Button>
          {mailError ? (
            <p className="text-xs text-danger" role="status">{mailError}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 text-[11px] text-text-tertiary border-t border-border-secondary pt-2">
        <span>Создано: {formatTs(task.createdAt)}</span>
        <span>Обновлено: {formatTs(task.updatedAt)}</span>
        {task.syncState !== "fresh" ? (
          <span>Синхронизация: {task.syncState}</span>
        ) : null}
      </div>
    </div>
  );
}

export interface ProjectedTaskDetailModalProps {
  task: Task | null;
  isOpen: boolean;
  onClose: () => void;
}

/** Shared projection Task detail (Tracker / cached). Not the legacy DbTask modal. */
export function ProjectedTaskDetailModal({ task, isOpen, onClose }: ProjectedTaskDetailModalProps) {
  const titleId = useId();
  return (
    <Modal
      isOpen={isOpen && Boolean(task)}
      onClose={onClose}
      title={task?.title ?? "Задача"}
      width="w-full max-w-lg"
      renderHeader={
        task ? (
          <div className="px-4 py-3 border-b border-border-primary flex items-start justify-between gap-3">
            <h3 id={titleId} className="text-sm font-semibold text-text-primary pr-2">
              {task.title}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-text-tertiary hover:text-text-primary text-lg leading-none"
              aria-label="Закрыть"
            >
              ×
            </button>
          </div>
        ) : null
      }
    >
      {task ? <TaskDetailView task={task} onOpenMailDone={onClose} /> : null}
    </Modal>
  );
}

export { principalPrimaryLabel };
