import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { PersonIdentity } from "@/services/people/domain";
import type { Task, TaskPriority } from "@/services/tasks/domain";
import {
  CREATE_TASK_ERROR_COPY,
  createDefaultTrackerProvider,
  createTrackerTaskFromMail,
  evaluateCreateTaskGate,
  newClientTaskId,
  snapshotMailSource,
  taskErrorMessageRu,
  type MailTaskSourceSnapshot,
} from "@/services/tasks/mailCreateFlow";
import { SqliteTaskRepository } from "@/services/tasks/taskRepository";
import { isTaskError } from "@/services/tasks/yandexTracker";
import { OrganizationPeoplePicker } from "./OrganizationPeoplePicker";

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Низкий" },
  { value: "normal", label: "Обычный" },
  { value: "high", label: "Высокий" },
  { value: "critical", label: "Критический" },
];

export interface CreateTrackerTaskFromMailModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  source: MailTaskSourceSnapshot;
  onCreated: (task: Task) => void;
}

function dueDateToUnix(dateValue: string): number | null {
  if (!dateValue) return null;
  // Date-only → local noon to avoid timezone day-shift surprises for Tracker YYYY-MM-DD.
  const [y, m, d] = dateValue.split("-").map(Number);
  if (!y || !m || !d) return null;
  return Math.floor(new Date(y, m - 1, d, 12, 0, 0, 0).getTime() / 1000);
}

export function CreateTrackerTaskFromMailModal({
  isOpen,
  onClose,
  accountId,
  source,
  onCreated,
}: CreateTrackerTaskFromMailModalProps) {
  const titleId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [clientTaskId] = useState(() => newClientTaskId());
  const [title, setTitle] = useState(source.subject?.trim() || "(без темы)");
  const [description, setDescription] = useState(
    source.subject?.trim()
      ? `Задача создана из письма «${source.subject.trim()}»`
      : "",
  );
  const [assignee, setAssignee] = useState<PersonIdentity | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setBooting(true);
    setGateError(null);
    setSubmitError(null);
    void evaluateCreateTaskGate({ accountId }).then((gate) => {
      if (cancelled) return;
      if (!gate.ok) {
        setGateError(gate.messageRu);
        setOrganizationId(null);
      } else {
        setOrganizationId(gate.organizationId);
      }
      setBooting(false);
      window.setTimeout(() => firstFieldRef.current?.focus(), 0);
    });
    return () => { cancelled = true; };
  }, [isOpen, accountId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !organizationId || !assignee) return;
    setSubmitting(true);
    setSubmitError(null);
    const repository = new SqliteTaskRepository();
    const provider = createDefaultTrackerProvider(accountId, repository);
    try {
      const resolved = await provider.resolveAssignee(organizationId, {
        person: assignee,
        email: assignee.email,
        displayName: assignee.displayName,
        organizationId,
        providerUid: assignee.providerId,
      });
      if (!resolved?.providerUid) {
        setSubmitError(CREATE_TASK_ERROR_COPY["assignee-unresolved"]);
        setSubmitting(false);
        return;
      }

      const task = await createTrackerTaskFromMail({
        repository,
        provider,
        payload: {
          accountId,
          organizationId,
          clientTaskId,
          source,
          title: title.trim(),
          description: description.trim() || null,
          assignee: resolved,
          priority,
          dueAt: dueDateToUnix(dueDate),
        },
      });
      onCreated(task);
      onClose();
    } catch (error) {
      setSubmitError(taskErrorMessageRu(error));
      if (isTaskError(error) && error.code === "assignee-unresolved") {
        setSubmitError("Не удалось подтвердить исполнителя в организации Tracker");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { if (!submitting) onClose(); }}
      title="Создать задачу"
      width="w-full max-w-lg"
      panelClassName="mx-4"
    >
      <form className="p-4 space-y-3" onSubmit={(e) => void handleSubmit(e)} aria-labelledby={titleId}>
        <h2 id={titleId} className="sr-only">Создать задачу из письма</h2>

        <div className="rounded-md border border-border-secondary bg-bg-secondary px-3 py-2 text-xs text-text-secondary space-y-1">
          <div className="font-medium text-text-primary">Источник: письмо</div>
          <div className="truncate"><span className="text-text-tertiary">Тема:</span> {source.subject ?? "(без темы)"}</div>
          <div className="truncate"><span className="text-text-tertiary">От:</span> {source.sender ?? "—"}</div>
        </div>

        {booting && (
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <Loader2 size={12} className="animate-spin" />
            Проверка настроек Tracker…
          </div>
        )}

        {gateError && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning" role="alert">
            {gateError}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1" htmlFor="create-task-title">
            Название
          </label>
          <input
            ref={firstFieldRef}
            id="create-task-title"
            required
            disabled={Boolean(gateError) || submitting}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>

        {organizationId && !gateError && (
          <OrganizationPeoplePicker
            accountId={accountId}
            organizationId={organizationId}
            value={assignee}
            onChange={setAssignee}
            disabled={submitting}
            allowManual={false}
            policy="confirmed-organization-member"
          />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1" htmlFor="create-task-due">
              Срок
            </label>
            <input
              id="create-task-due"
              type="date"
              disabled={Boolean(gateError) || submitting}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-md border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <p className="mt-1 text-[11px] text-text-tertiary">Можно оставить без срока</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1" htmlFor="create-task-priority">
              Приоритет
            </label>
            <select
              id="create-task-priority"
              disabled={Boolean(gateError) || submitting}
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="w-full rounded-md border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {PRIORITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1" htmlFor="create-task-desc">
            Описание
          </label>
          <textarea
            id="create-task-desc"
            rows={3}
            disabled={Boolean(gateError) || submitting}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40 resize-y"
          />
        </div>

        {submitError && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
            {submitError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" disabled={submitting} onClick={onClose}>
            Отмена
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={Boolean(gateError) || submitting || !assignee || !title.trim()}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                Создание…
              </span>
            ) : (
              "Создать"
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export { snapshotMailSource };
