import { useCallback, useEffect, useId, useState } from "react";
import { ExternalLink, Loader2, Mail, RefreshCw } from "lucide-react";
import type { TaskProviderCapabilities } from "@/services/tasks/taskProvider";
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
import {
  CREATE_TASK_ERROR_COPY,
  createDefaultTrackerProvider,
  taskErrorMessageRu,
} from "@/services/tasks/mailCreateFlow";
import { SqliteTaskRepository } from "@/services/tasks/taskRepository";
import { TaskService } from "@/services/tasks/taskService";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { TaskPersonCell, principalPrimaryLabel } from "./TaskPersonCell";
import { OrganizationPeoplePicker } from "./OrganizationPeoplePicker";
import type { PersonIdentity } from "@/services/people/domain";
import type { Task, TaskPriority, TaskPrincipalRef } from "@/services/tasks/domain";
import type { TrackerTransition } from "@/services/yandex/trackerClient";
import { isTaskError } from "@/services/tasks/yandexTracker/errors";

function formatTs(unix: number): string {
  return new Date(unix * 1000).toLocaleString("ru-RU");
}

function buildService(): TaskService {
  const repository = new SqliteTaskRepository();
  return new TaskService(repository, (id) => createDefaultTrackerProvider(id, repository));
}

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Низкий" },
  { value: "normal", label: "Обычный" },
  { value: "high", label: "Высокий" },
  { value: "critical", label: "Критический" },
];

const AVAILABILITY_COPY: Record<string, string> = {
  unavailable: "Задача недоступна в Tracker (возможно, удалена или перемещена)",
  removed: "Задача удалена в Tracker",
  "permission-denied": "Нет доступа к этой задаче в Tracker",
  error: "Не удалось обновить задачу",
  stale: "Данные могут быть устаревшими",
};

export interface TaskDetailViewProps {
  task: Task;
  accountId?: string | null;
  onOpenMailDone?: () => void;
  onTaskUpdated?: (task: Task) => void;
}

export function TaskDetailView({
  task: initial,
  accountId,
  onOpenMailDone,
  onTaskUpdated,
}: TaskDetailViewProps) {
  const [task, setTask] = useState(initial);
  useEffect(() => {
    setTask(initial);
  }, [initial]);

  const mailSource = mailSourceOf(task);
  const [mailError, setMailError] = useState<string | null>(null);
  const [openingMail, setOpeningMail] = useState(false);
  const [caps, setCaps] = useState<TaskProviderCapabilities | null>(null);
  const [transitions, setTransitions] = useState<TrackerTransition[]>([]);
  const [loadingTransitions, setLoadingTransitions] = useState(false);
  const [selectedTransition, setSelectedTransition] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descriptionDraft, setDescriptionDraft] = useState(task.description ?? "");
  const [priorityDraft, setPriorityDraft] = useState<TaskPriority>(
    task.priority === "unknown" ? "normal" : task.priority,
  );
  const [dueDraft, setDueDraft] = useState(
    task.dueAt ? new Date(task.dueAt * 1000).toISOString().slice(0, 10) : "",
  );
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState<PersonIdentity | null>(null);
  const offline = typeof navigator !== "undefined" ? !navigator.onLine : false;
  const orgId = task.organizationId;
  const providerKey = task.providerTaskId ?? task.externalKey;
  const readOnly = Boolean(caps && caps.read && !caps.transitions && !caps.create && !caps.assign);
  const canMutate = Boolean(accountId && orgId && providerKey && caps && !offline && !readOnly);
  const canAssign = Boolean(canMutate && caps?.assign);

  const applyTask = useCallback(
    (next: Task) => {
      setTask(next);
      onTaskUpdated?.(next);
      window.dispatchEvent(new CustomEvent("velo-task-updated"));
    },
    [onTaskUpdated],
  );

  useEffect(() => {
    if (!accountId || !orgId) return;
    let cancelled = false;
    void (async () => {
      try {
        const service = buildService();
        const nextCaps = await service.capabilities(accountId, orgId);
        if (!cancelled) setCaps(nextCaps);
      } catch {
        if (!cancelled) setCaps(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, orgId]);

  useEffect(() => {
    if (!accountId || !orgId || !providerKey || !caps?.transitions || offline) {
      setTransitions([]);
      return;
    }
    let cancelled = false;
    setLoadingTransitions(true);
    void (async () => {
      try {
        const list = await buildService().listTransitions({
          accountId,
          organizationId: orgId,
          providerTaskId: providerKey,
        });
        if (!cancelled) {
          setTransitions(list);
          setSelectedTransition("");
        }
      } catch {
        if (!cancelled) setTransitions([]);
      } finally {
        if (!cancelled) setLoadingTransitions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, orgId, providerKey, caps?.transitions, offline, task.status, task.providerStatus?.key]);

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

  const refreshOne = async () => {
    if (!accountId || !orgId || !providerKey) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await buildService().refreshTask({
        accountId,
        organizationId: orgId,
        providerTaskId: providerKey,
        localTaskId: task.id,
      });
      if (result.ok) {
        applyTask(result.task);
      } else {
        if (result.task) applyTask(result.task);
        setActionError(
          AVAILABILITY_COPY[result.reason] ?? AVAILABILITY_COPY.error ?? "Не удалось обновить задачу",
        );
      }
    } catch (e) {
      setActionError(taskErrorMessageRu(e));
    } finally {
      setBusy(false);
    }
  };

  const runTransition = async () => {
    if (!canMutate || !selectedTransition || !caps?.transitions) return;
    setBusy(true);
    setActionError(null);
    try {
      const next = await buildService().transitionTask({
        accountId: accountId!,
        organizationId: orgId!,
        providerTaskId: providerKey!,
        transitionId: selectedTransition,
        localTaskId: task.id,
      });
      applyTask(next);
      setSelectedTransition("");
    } catch (e) {
      setActionError(taskErrorMessageRu(e));
      // After conflict — refresh canonical
      try {
        await refreshOne();
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  };

  const saveEdits = async () => {
    if (!canMutate) return;
    setBusy(true);
    setActionError(null);
    try {
      const fields: Partial<Pick<Task, "title" | "description" | "priority" | "dueAt">> = {};
      if (caps?.create || caps?.assign) {
        fields.title = titleDraft.trim();
        fields.description = descriptionDraft;
      }
      if (caps?.priority) fields.priority = priorityDraft;
      if (caps?.dueDate) {
        fields.dueAt = dueDraft
          ? Math.floor(Date.parse(`${dueDraft}T00:00:00.000Z`) / 1000)
          : null;
      }
      const next = await buildService().updateTaskFields({
        accountId: accountId!,
        organizationId: orgId!,
        providerTaskId: providerKey!,
        fields,
        localTaskId: task.id,
      });
      applyTask(next);
      setEditing(false);
    } catch (e) {
      setActionError(taskErrorMessageRu(e));
    } finally {
      setBusy(false);
    }
  };

  const saveAssignee = async () => {
    if (!canAssign || !assigneeDraft || !accountId || !orgId || !providerKey) return;
    if (assigneeDraft.source !== "organization-directory") {
      setActionError("Можно выбрать только подтверждённого сотрудника организации");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const service = buildService();
      const principal: TaskPrincipalRef = {
        person: assigneeDraft,
        email: assigneeDraft.email,
        displayName: assigneeDraft.displayName,
        organizationId: orgId,
        providerUid: assigneeDraft.providerId,
      };
      const resolved = await service.resolveMailAssignee(accountId, orgId, principal);
      if (!resolved.providerUid) {
        setActionError(CREATE_TASK_ERROR_COPY["assignee-unresolved"]);
        return;
      }
      const next = await service.updateTaskFields({
        accountId,
        organizationId: orgId,
        providerTaskId: providerKey,
        fields: { assignee: resolved },
        localTaskId: task.id,
      });
      applyTask(next);
      setEditingAssignee(false);
      setAssigneeDraft(null);
    } catch (e) {
      if (isTaskError(e) && e.code === "assignee-unresolved") {
        setActionError(CREATE_TASK_ERROR_COPY["assignee-unresolved"]);
      } else if (isTaskError(e) && e.code === "offline") {
        setActionError("Нет сети — смена исполнителя недоступна");
      } else if (isTaskError(e) && e.code === "permission-denied") {
        setActionError("Нет прав на смену исполнителя в Tracker");
      } else {
        setActionError(taskErrorMessageRu(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const disabledReason = offline
    ? "Нет сети — изменения недоступны"
    : readOnly
      ? "Только чтение: нет scope tracker:write"
      : !accountId
        ? "Нет аккаунта"
        : null;

  return (
    <div className="p-4 space-y-3 text-sm text-text-secondary max-h-[70vh] overflow-y-auto">
      {(task.syncState === "unavailable"
        || task.syncState === "removed"
        || task.syncState === "permission-denied"
        || task.syncState === "error"
        || task.syncState === "stale") ? (
        <p className="text-xs text-warning" role="status">
          {AVAILABILITY_COPY[task.syncState] ?? task.syncState}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="xs"
          disabled={busy || offline || !accountId}
          onClick={() => void refreshOne()}
          aria-label="Обновить задачу"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          <span className="ml-1">Обновить</span>
        </Button>
        {disabledReason ? (
          <span className="text-[11px] text-text-tertiary">{disabledReason}</span>
        ) : null}
      </div>

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

      {caps?.transitions && !offline ? (
        <div className="rounded-md border border-border-primary p-3 space-y-2" aria-label="Смена статуса">
          <div className="text-xs font-semibold text-text-primary">Статус (переход)</div>
          {loadingTransitions ? (
            <p className="text-xs text-text-tertiary">Загрузка переходов…</p>
          ) : transitions.length === 0 ? (
            <p className="text-xs text-text-tertiary">Нет доступных переходов</p>
          ) : (
            <div className="flex flex-wrap gap-2 items-center">
              <select
                value={selectedTransition}
                onChange={(e) => setSelectedTransition(e.target.value)}
                disabled={!canMutate || busy || !caps.transitions}
                aria-label="Доступные переходы статуса"
                className="flex-1 min-w-[140px] bg-bg-tertiary text-text-primary text-xs px-2 py-1.5 rounded-md border border-border-primary"
              >
                <option value="">Выберите переход…</option>
                {transitions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.display}
                    {t.to?.display ? ` → ${t.to.display}` : ""}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="primary"
                size="xs"
                disabled={!canMutate || busy || !selectedTransition || !caps.transitions}
                onClick={() => void runTransition()}
                title={!caps.transitions || readOnly ? "Переходы недоступны (только чтение)" : undefined}
              >
                Применить
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {editing ? (
        <div className="space-y-2 border border-border-primary rounded-md p-3">
          <label className="block text-xs">
            <span className="text-text-tertiary">Название</span>
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              className="mt-1 w-full bg-bg-tertiary border border-border-primary rounded px-2 py-1 text-text-primary text-sm"
              disabled={!canMutate}
            />
          </label>
          <label className="block text-xs">
            <span className="text-text-tertiary">Описание</span>
            <textarea
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              rows={4}
              className="mt-1 w-full bg-bg-tertiary border border-border-primary rounded px-2 py-1 text-text-primary text-sm"
              disabled={!canMutate}
            />
          </label>
          {caps?.priority ? (
            <label className="block text-xs">
              <span className="text-text-tertiary">Приоритет</span>
              <select
                value={priorityDraft}
                onChange={(e) => setPriorityDraft(e.target.value as TaskPriority)}
                className="mt-1 w-full bg-bg-tertiary border border-border-primary rounded px-2 py-1 text-text-primary text-sm"
                disabled={!canMutate}
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          {caps?.dueDate ? (
            <label className="block text-xs">
              <span className="text-text-tertiary">Срок (UTC date)</span>
              <input
                type="date"
                value={dueDraft}
                onChange={(e) => setDueDraft(e.target.value)}
                className="mt-1 w-full bg-bg-tertiary border border-border-primary rounded px-2 py-1 text-text-primary text-sm"
                disabled={!canMutate}
              />
            </label>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" size="xs" variant="primary" disabled={busy || !canMutate} onClick={() => void saveEdits()}>
              Сохранить
            </Button>
            <Button type="button" size="xs" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            size="xs"
            variant="secondary"
            disabled={!canMutate || (!(caps?.priority || caps?.dueDate || caps?.create))}
            onClick={() => {
              setTitleDraft(task.title);
              setDescriptionDraft(task.description ?? "");
              setPriorityDraft(task.priority === "unknown" ? "normal" : task.priority);
              setDueDraft(task.dueAt ? new Date(task.dueAt * 1000).toISOString().slice(0, 10) : "");
              setEditing(true);
            }}
          >
            Редактировать
          </Button>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="text-xs text-text-tertiary mb-1">Исполнитель</div>
          {editingAssignee && accountId && orgId ? (
            <div className="space-y-2">
              <OrganizationPeoplePicker
                accountId={accountId}
                organizationId={orgId}
                value={assigneeDraft}
                onChange={setAssigneeDraft}
                disabled={busy || !canAssign}
                allowManual={false}
                policy="confirmed-organization-member"
                label="Новый исполнитель"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="primary"
                  disabled={busy || !canAssign || !assigneeDraft}
                  onClick={() => void saveAssignee()}
                >
                  {busy ? "Сохранение…" : "Назначить"}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setEditingAssignee(false);
                    setAssigneeDraft(null);
                  }}
                >
                  Отмена
                </Button>
              </div>
              {!canAssign ? (
                <p className="text-[11px] text-text-tertiary" role="status">
                  {offline
                    ? "Нет сети — смена исполнителя недоступна"
                    : readOnly
                      ? "Только чтение: нет scope tracker:write"
                      : "Смена исполнителя недоступна для текущих прав"}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <TaskPersonCell principal={task.assignee} compact={false} />
              <Button
                type="button"
                size="xs"
                variant="secondary"
                disabled={!canAssign}
                title={
                  offline
                    ? "Нет сети"
                    : readOnly
                      ? "Только чтение"
                      : !caps?.assign
                        ? "Нет права assign"
                        : undefined
                }
                onClick={() => {
                  setAssigneeDraft(null);
                  setEditingAssignee(true);
                }}
              >
                Сменить исполнителя
              </Button>
            </div>
          )}
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

      {!editing && task.description ? (
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

      {actionError ? (
        <p className="text-xs text-danger" role="alert">{actionError}</p>
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
  accountId?: string | null;
  onTaskUpdated?: (task: Task) => void;
}

/** Shared projection Task detail (Tracker / cached). Not the legacy DbTask modal. */
export function ProjectedTaskDetailModal({
  task,
  isOpen,
  onClose,
  accountId,
  onTaskUpdated,
}: ProjectedTaskDetailModalProps) {
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
      {task ? (
        <TaskDetailView
          task={task}
          accountId={accountId}
          onOpenMailDone={onClose}
          onTaskUpdated={onTaskUpdated}
        />
      ) : null}
    </Modal>
  );
}

export { principalPrimaryLabel };
