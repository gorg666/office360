import { useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import type { DbCalendar } from "@/services/db/calendars";
import type { CalendarEventTime, CalendarProviderCapabilities, CalendarReminderPolicy, RecurrenceDraft } from "@/services/calendar/domain";
import {
  emptyRecurrenceDraft,
  participantRefFromEmail,
  recurrenceContextFromForm,
  serializeRecurrenceRule,
  validateRecurrenceDraft,
} from "@/services/calendar/domain";
import { SchedulingAssistant, type PlanMeetingFn } from "./scheduling/SchedulingAssistant";
import { buildEditorSchedulingParticipants } from "./scheduling/schedulingView";
import { eventTimeFromFormFields } from "./createSelection";
import { ReminderEditor } from "./ReminderEditor";
import { RecurrenceRuleEditor } from "./recurrence/RecurrenceRuleEditor";
import { ParticipantAuthoring } from "./participants/ParticipantAuthoring";
import {
  hydrateAuthoredParticipants,
  type AuthoredParticipant,
} from "./participants/authoredParticipants";

interface EventCreateModalProps {
  calendars?: DbCalendar[];
  initialValues?: Partial<EventCreateInput>;
  accountId?: string | null;
  selfEmail?: string | null;
  selfDisplayName?: string | null;
  timeZone?: string;
  planMeeting?: PlanMeetingFn;
  debounceMs?: number;
  capabilities?: CalendarProviderCapabilities | null;
  onClose: () => void;
  onCreate: (event: EventCreateInput) => void | Promise<void>;
}

export interface EventCreateInput {
  summary: string;
  description: string;
  location: string;
  startTime: string;
  endTime: string;
  attendees: AuthoredParticipant[];
  calendarId?: string;
  allDay?: boolean;
  time?: CalendarEventTime;
  reminders?: CalendarReminderPolicy;
  recurrenceRule?: string | null;
}

export function EventCreateModal({
  calendars,
  initialValues,
  accountId,
  selfEmail,
  selfDisplayName,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  planMeeting,
  debounceMs,
  capabilities = null,
  onClose,
  onCreate,
}: EventCreateModalProps) {
  const [summary, setSummary] = useState(initialValues?.summary ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [location, setLocation] = useState(initialValues?.location ?? "");
  const [startTime, setStartTime] = useState(initialValues?.startTime ?? getDefaultStart());
  const [endTime, setEndTime] = useState(initialValues?.endTime ?? getDefaultEnd());
  const [attendees, setAttendees] = useState<AuthoredParticipant[]>(() => hydrateAuthoredParticipants(initialValues?.attendees));
  const [allDay, setAllDay] = useState(Boolean(initialValues?.allDay));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<RecurrenceDraft>(emptyRecurrenceDraft);
  const [reminders, setReminders] = useState<CalendarReminderPolicy | null>(
    initialValues?.reminders ?? (capabilities
      ? (capabilities.reminders.defaults === "inherit" ? { kind: "inherit" } : { kind: "none" })
      : null),
  );
  const [calendarId, setCalendarId] = useState<string>(
    calendars?.find((c) => c.is_primary)?.id ?? calendars?.[0]?.id ?? "",
  );
  const schedulingParticipants = useMemo(
    () => buildEditorSchedulingParticipants({
      selfEmail,
      selfDisplayName,
      attendees: attendees.map((row) => ({
        participant: participantRefFromEmail(row.email, row.displayName),
        role: row.role,
      })),
    }),
    [attendees, selfDisplayName, selfEmail],
  );

  useEffect(() => {
    if (reminders !== null || !capabilities) return;
    setReminders(capabilities.reminders.defaults === "inherit" ? { kind: "inherit" } : { kind: "none" });
  }, [capabilities, reminders]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) return;

    const time = eventTimeFromFormFields({ allDay, startTime, endTime, timeZone });
    if (!time) {
      setError(allDay
        ? "Проверьте даты события."
        : "Время окончания должно быть позже времени начала.");
      return;
    }

    const eventStartDate = startTime.slice(0, 10);
    const recurrenceErrors = validateRecurrenceDraft(recurrence, eventStartDate);
    if (recurrenceErrors.length > 0) {
      setError(recurrenceErrors[0] ?? "Проверьте правило повторения.");
      return;
    }

    let recurrenceRule: string | null = null;
    try {
      recurrenceRule = serializeRecurrenceRule(recurrence, recurrenceContextFromForm({
        startTime,
        allDay,
        timeZone,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверьте правило повторения.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        summary: summary.trim(),
        description,
        location,
        startTime,
        endTime,
        attendees,
        calendarId: calendarId || undefined,
        allDay,
        time,
        recurrenceRule,
        ...(reminders ? { reminders } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать событие.");
    } finally {
      setSubmitting(false);
    }
  }, [summary, description, location, startTime, endTime, attendees, calendarId, allDay, timeZone, reminders, recurrence, onCreate]);

  return (
    <Modal isOpen={true} onClose={onClose} title="Новое событие" width="w-full max-w-5xl" panelClassName="max-h-[90vh] overflow-hidden">
      <form onSubmit={handleSubmit} className="max-h-[calc(90vh-3.5rem)] space-y-3 overflow-y-auto p-4">
        <TextField
          label="Название"
          type="text"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Название события"
          autoFocus
        />

        <ReminderEditor capabilities={capabilities} value={reminders} onChange={setReminders} />

        {calendars && calendars.length > 1 && (
          <div>
            <label htmlFor="event-calendar" className="text-xs text-text-secondary block mb-1">Календарь</label>
            <select
              id="event-calendar"
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              className="w-full px-3 py-1.5 bg-bg-tertiary border border-border-primary rounded text-sm text-text-primary outline-none focus:border-accent"
            >
              {calendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.display_name ?? "Календарь"}
                  {cal.is_primary ? " (основной)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            data-testid="event-all-day"
            checked={allDay}
            onChange={(event) => {
              const next = event.target.checked;
              setAllDay(next);
              if (next) {
                setStartTime(datePart(startTime));
                setEndTime(datePart(endTime));
              } else {
                setStartTime(toDatetimeLocal(startTime, "09:00"));
                setEndTime(toDatetimeLocal(endTime, "10:00"));
              }
            }}
          />
          Весь день
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label="Начало"
            type={allDay ? "date" : "datetime-local"}
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <TextField
            label="Окончание"
            type={allDay ? "date" : "datetime-local"}
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>

        <RecurrenceRuleEditor
          value={recurrence}
          eventStartDate={startTime.slice(0, 10)}
          onChange={setRecurrence}
        />

        <TextField
          label="Место"
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Добавить место"
        />

        <ParticipantAuthoring
          accountId={accountId}
          value={attendees}
          organizerEmail={selfEmail}
          onChange={setAttendees}
        />

        {!allDay ? (
          <SchedulingAssistant
            accountId={accountId}
            timeZone={timeZone}
            startTime={startTime}
            endTime={endTime}
            participants={schedulingParticipants}
            planMeeting={planMeeting}
            debounceMs={debounceMs}
            onSelectRange={(nextStart, nextEnd) => {
              setStartTime(nextStart);
              setEndTime(nextEnd);
            }}
          />
        ) : null}

        <div>
          <label className="text-xs text-text-secondary block mb-1" htmlFor="event-description">Описание</label>
          <textarea
            id="event-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Добавить описание"
            rows={3}
            className="w-full px-3 py-1.5 bg-bg-tertiary border border-border-primary rounded text-sm text-text-primary outline-none focus:border-accent resize-none"
          />
        </div>

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end">
          {error && (
            <div className="w-full min-w-0 text-xs text-danger sm:mr-auto sm:max-w-[60%]" role="alert">
              {error}
            </div>
          )}
          <div className="flex shrink-0 justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={onClose}
              disabled={submitting}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={submitting || !summary.trim()}
            >
              {submitting ? "Создание..." : "Создать"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function getDefaultStart(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  return toLocalISOString(now);
}

function getDefaultEnd(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 2);
  return toLocalISOString(now);
}

function toLocalISOString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function datePart(value: string): string {
  return value.slice(0, 10);
}

function toDatetimeLocal(value: string, fallbackTime: string): string {
  if (value.includes("T")) return value;
  return `${datePart(value)}T${fallbackTime}`;
}
