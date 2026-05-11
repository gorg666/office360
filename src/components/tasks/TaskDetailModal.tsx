import { useCallback, useMemo, useState } from "react";
import {
  Bell,
  Calendar,
  Check,
  Loader2,
  MapPin,
  Paperclip,
  Trash2,
  UserPlus,
  Video,
  X,
} from "lucide-react";
import { updateTask, type DbTask, type TaskPriority } from "@/services/db/tasks";
import { createTelemostConference } from "@/services/yandex360/telemost";

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "none", label: "Без приоритета" },
  { value: "low", label: "Низкий" },
  { value: "medium", label: "Средний" },
  { value: "high", label: "Высокий" },
  { value: "urgent", label: "Срочный" },
];

const RECURRENCE_OPTIONS = [
  { value: "", label: "Не повторяется" },
  { value: JSON.stringify({ type: "daily", interval: 1 }), label: "Каждый день" },
  { value: JSON.stringify({ type: "weekly", interval: 1 }), label: "Каждую неделю" },
  { value: JSON.stringify({ type: "monthly", interval: 1 }), label: "Каждый месяц" },
  { value: JSON.stringify({ type: "yearly", interval: 1 }), label: "Каждый год" },
];

const REMINDER_OPTIONS = [
  { value: "", label: "Не напоминать" },
  { value: "5", label: "За 5 минут" },
  { value: "15", label: "За 15 минут" },
  { value: "30", label: "За 30 минут" },
  { value: "60", label: "За 1 час" },
  { value: "1440", label: "За 1 день" },
];

function formatDateTimeLocal(timestamp: number | null | undefined, fallback: Date): string {
  const date = timestamp ? new Date(timestamp * 1000) : fallback;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocal(value: string): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor(date.getTime() / 1000);
}

function readJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseListInput(value: string): string[] {
  return value
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    const serialized = JSON.stringify(err);
    return serialized && serialized !== "{}" ? serialized : fallback;
  } catch {
    return fallback;
  }
}

interface TaskDetailModalProps {
  task: DbTask;
  accountId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function TaskDetailModal({ task, accountId, onClose, onSaved }: TaskDetailModalProps) {
  const now = useMemo(() => new Date(), []);
  const defaultEnd = useMemo(() => new Date(now.getTime() + 30 * 60 * 1000), [now]);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [startAt, setStartAt] = useState(() => formatDateTimeLocal(task.start_at ?? task.due_date, now));
  const [endAt, setEndAt] = useState(() => formatDateTimeLocal(task.end_at, defaultEnd));
  const [timezone, setTimezone] = useState(task.timezone ?? "UTC+3 Москва, Санкт-Петербург");
  const [allDay, setAllDay] = useState(task.all_day === 1);
  const [recurrenceRule, setRecurrenceRule] = useState(task.recurrence_rule ?? "");
  const [location, setLocation] = useState(task.location ?? "");
  const [participants, setParticipants] = useState(readJsonArray(task.participants_json).join(", "));
  const [optionalParticipants, setOptionalParticipants] = useState(readJsonArray(task.optional_participants_json).join(", "));
  const [attachments, setAttachments] = useState<string[]>(() => readJsonArray(task.attachments_json));
  const [reminderMinutes, setReminderMinutes] = useState(task.reminder_minutes ? String(task.reminder_minutes) : "15");
  const [colorLabel, setColorLabel] = useState(task.color_label ?? "Календарь: Мои события");
  const [telemostUrl, setTelemostUrl] = useState(task.telemost_url ?? "");
  const [telemostConferenceId, setTelemostConferenceId] = useState(task.telemost_conference_id ?? "");
  const [telemostLiveUrl, setTelemostLiveUrl] = useState(task.telemost_live_url ?? "");
  const [saving, setSaving] = useState(false);
  const [creatingTelemost, setCreatingTelemost] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePickAttachments = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ multiple: true, title: "Прикрепить файлы к задаче" });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setAttachments((current) => [...current, ...paths]);
  }, []);

  const handleCreateTelemost = useCallback(async () => {
    setCreatingTelemost(true);
    setError(null);
    try {
      const conference = await createTelemostConference({
        accountId,
        cohostEmails: [...parseListInput(participants), ...parseListInput(optionalParticipants)],
        waitingRoomLevel: "PUBLIC",
      });
      setTelemostUrl(conference.joinUrl);
      setTelemostConferenceId(conference.id);
      setTelemostLiveUrl(conference.liveStreamWatchUrl ?? "");
    } catch (err) {
      setError(getErrorMessage(err, "Не удалось создать ссылку Яндекс.Телемоста"));
    } finally {
      setCreatingTelemost(false);
    }
  }, [accountId, optionalParticipants, participants]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      setError("Введите название задачи.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const startTimestamp = parseDateTimeLocal(startAt);
      const endTimestamp = parseDateTimeLocal(endAt);
      await updateTask(task.id, {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        dueDate: startTimestamp,
        startAt: startTimestamp,
        endAt: endTimestamp,
        timezone: timezone.trim() || null,
        allDay,
        recurrenceRule: recurrenceRule || null,
        location: location.trim() || null,
        participantsJson: JSON.stringify(parseListInput(participants)),
        optionalParticipantsJson: JSON.stringify(parseListInput(optionalParticipants)),
        attachmentsJson: JSON.stringify(attachments),
        reminderMinutes: reminderMinutes ? Number(reminderMinutes) : null,
        reminderChannel: reminderMinutes ? "email" : null,
        colorLabel: colorLabel.trim() || null,
        telemostUrl: telemostUrl.trim() || null,
        telemostConferenceId: telemostConferenceId || null,
        telemostLiveUrl: telemostLiveUrl || null,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Не удалось сохранить задачу."));
    } finally {
      setSaving(false);
    }
  }, [
    allDay,
    attachments,
    colorLabel,
    description,
    endAt,
    location,
    onClose,
    onSaved,
    optionalParticipants,
    participants,
    priority,
    recurrenceRule,
    reminderMinutes,
    startAt,
    task.id,
    telemostConferenceId,
    telemostLiveUrl,
    telemostUrl,
    timezone,
    title,
  ]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 glass-backdrop">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border-primary bg-bg-primary shadow-2xl">
        <header className="flex items-center justify-between border-b border-border-primary px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary" aria-label="Закрыть">
            <X size={18} />
          </button>
          <h2 className="text-base font-semibold text-text-primary">Подробности задачи</h2>
          <button type="button" onClick={handleSave} disabled={saving} className="rounded-lg p-1.5 text-success hover:bg-success/10 disabled:opacity-50" aria-label="Сохранить задачу">
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={20} />}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <section className="border-b border-border-primary p-4">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Название"
              className="w-full bg-transparent text-xl font-semibold text-text-primary outline-none placeholder:text-text-tertiary"
              aria-label="Название задачи"
            />
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Описание"
              className="mt-3 min-h-20 w-full resize-none bg-transparent text-sm text-text-secondary outline-none placeholder:text-text-tertiary"
              aria-label="Описание задачи"
            />
            <label className="mt-3 block text-xs text-text-secondary">
              Приоритет
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
                className="mt-1 w-full rounded-lg border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
              >
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </section>

          <SectionTitle>Телемост</SectionTitle>
          <section className="divide-y divide-border-secondary">
            <button
              type="button"
              onClick={handleCreateTelemost}
              disabled={creatingTelemost}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-bg-hover disabled:opacity-60"
            >
              <span className="flex min-w-0 items-center gap-3">
                <Video size={18} className="text-accent" />
                <span className="min-w-0">
                  <span className="block text-sm text-text-primary">
                    {telemostUrl ? "Ссылка Яндекс.Телемоста создана" : "Добавить видеовстречу Яндекс.Телемост"}
                  </span>
                  {telemostUrl ? (
                    <span className="block truncate text-xs text-accent">{telemostUrl}</span>
                  ) : null}
                </span>
              </span>
              {creatingTelemost ? <Loader2 size={16} className="animate-spin text-text-tertiary" /> : null}
            </button>
          </section>

          <SectionTitle>Время и дата</SectionTitle>
          <section className="divide-y divide-border-secondary">
            <DateRow label="Начало" value={startAt} onChange={setStartAt} />
            <DateRow label="Окончание" value={endAt} onChange={setEndAt} />
            <TextRow label="Часовой пояс события" value={timezone} onChange={setTimezone} />
            <ToggleRow label="Весь день" checked={allDay} onChange={setAllDay} />
            <SelectRow label="Повтор" value={recurrenceRule} onChange={setRecurrenceRule} options={RECURRENCE_OPTIONS} />
          </section>

          <SectionTitle>Место</SectionTitle>
          <section>
            <IconTextRow icon={<MapPin size={18} className="text-red-500" />} label="Указать место" value={location} onChange={setLocation} />
          </section>

          <SectionTitle>Участники</SectionTitle>
          <section className="divide-y divide-border-secondary">
            <IconTextRow icon={<UserPlus size={18} />} label="Добавить" value={participants} onChange={setParticipants} placeholder="email1@yandex.ru, email2@company.ru" />
          </section>

          <SectionTitle>Опциональные участники</SectionTitle>
          <section className="divide-y divide-border-secondary">
            <IconTextRow icon={<UserPlus size={18} />} label="Добавить" value={optionalParticipants} onChange={setOptionalParticipants} placeholder="email@example.com" />
          </section>

          <SectionTitle>Вложения</SectionTitle>
          <section className="divide-y divide-border-secondary">
            <button type="button" onClick={handlePickAttachments} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg-hover">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-tertiary text-text-secondary">
                <Paperclip size={18} />
              </span>
              <span className="text-sm text-text-primary">Прикрепить файл</span>
            </button>
            {attachments.map((path) => (
              <div key={path} className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-text-secondary">
                <span className="truncate">{path.split(/[\\/]/).pop() ?? path}</span>
                <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item !== path))} className="text-text-tertiary hover:text-danger" aria-label="Удалить вложение">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </section>

          <SectionTitle>Напомнить мне</SectionTitle>
          <section className="divide-y divide-border-secondary">
            <SelectRow label="Уведомление по e-mail" value={reminderMinutes} onChange={setReminderMinutes} options={REMINDER_OPTIONS} icon={<Bell size={18} />} />
          </section>

          <SectionTitle>Цветная метка</SectionTitle>
          <section>
            <TextRow label="Метка" value={colorLabel} onChange={setColorLabel} icon={<Calendar size={18} />} />
          </section>

          {error ? (
            <div className="m-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="bg-bg-tertiary px-4 py-2 text-sm font-semibold text-text-secondary">{children}</div>;
}

function DateRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 px-4 py-3 text-sm text-text-primary">
      <span>{label}</span>
      <input
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-56 rounded-lg border border-transparent bg-transparent px-2 py-1 text-right text-text-secondary outline-none hover:bg-bg-hover focus:border-accent"
      />
    </label>
  );
}

function TextRow({ label, value, onChange, icon }: { label: string; value: string; onChange: (value: string) => void; icon?: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3 px-4 py-3 text-sm text-text-primary">
      {icon ? <span className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-tertiary text-text-secondary">{icon}</span> : null}
      <span className="shrink-0">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-right text-text-secondary outline-none placeholder:text-text-tertiary"
      />
    </label>
  );
}

function IconTextRow({
  icon,
  label,
  value,
  onChange,
  placeholder,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex items-center gap-3 px-4 py-3 text-sm text-text-primary">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-tertiary text-text-secondary">{icon}</span>
      <span className="shrink-0">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-right text-text-secondary outline-none placeholder:text-text-tertiary"
      />
    </label>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-bg-hover">
      <span className="text-text-primary">{label}</span>
      <span className={`relative h-7 w-12 rounded-full transition-colors ${checked ? "bg-accent" : "bg-bg-tertiary"}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
      </span>
    </button>
  );
}

function SelectRow({
  label,
  value,
  onChange,
  options,
  icon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  icon?: React.ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-4 px-4 py-3 text-sm text-text-primary">
      <span className="flex items-center gap-3">
        {icon ? <span className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-tertiary text-text-secondary">{icon}</span> : null}
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="max-w-56 rounded-lg border border-transparent bg-transparent px-2 py-1 text-right text-text-secondary outline-none hover:bg-bg-hover focus:border-accent"
      >
        {options.map((option) => (
          <option key={option.value || "none"} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
