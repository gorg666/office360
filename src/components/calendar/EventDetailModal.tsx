import { useMemo, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, CircleHelp, Clock, Copy, ExternalLink, Mail, MapPin, Pencil, Repeat2, Trash2, User, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { DbCalendar } from "@/services/db/calendars";
import type { CalendarParticipationStatus } from "@/services/calendar/types";
import { calendarMutationService } from "@/services/calendar/calendarMutationService";
import { findCurrentAttendee, parseCalendarParticipants, parseCalendarReminderPolicy, type CalendarAttendee, type CalendarOrganizer, type CalendarProviderCapabilities, type CalendarReminderPolicy, type RecurrenceWriteScope } from "@/services/calendar/domain";
import { useAccountStore } from "@/stores/accountStore";
import { navigateToLabel } from "@/router/navigate";
import { cefNavigate } from "@/services/cef";
import { allDayStartDate } from "./eventTimeProjection";
import { RecurrenceScopeDialog } from "./recurrence/RecurrenceScopeDialog";
import { canMutateRecurring, classifyRecurringEditTarget, recurrenceScopeChoices, writeFailureCopy } from "./recurrence/recurrenceEditScope";
import { SchedulingAssistant, type PlanMeetingFn } from "./scheduling/SchedulingAssistant";
import { buildEditorSchedulingParticipants } from "./scheduling/schedulingView";
import { formatReminderPolicy, ReminderEditor } from "./ReminderEditor";

interface EventDetailModalProps {
  event: DbCalendarEvent;
  calendars: DbCalendar[];
  accountId: string;
  anchor?: { x: number; y: number } | null;
  timeZone?: string;
  planMeeting?: PlanMeetingFn;
  debounceMs?: number;
  onClose: () => void;
  onUpdated: () => void;
}

export function EventDetailModal({ event, calendars, accountId, anchor, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, planMeeting, debounceMs, onClose, onUpdated }: EventDetailModalProps) {
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(event.summary ?? "");
  const [description, setDescription] = useState(event.description ?? "");
  const [location, setLocation] = useState(event.location ?? "");
  const [startTime, setStartTime] = useState(toLocalISOString(new Date(event.start_time * 1000)));
  const [endTime, setEndTime] = useState(toLocalISOString(new Date(event.end_time * 1000)));
  const [busyAction, setBusyAction] = useState<"save" | "delete" | "rsvp" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<"update" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reminders, setReminders] = useState<CalendarReminderPolicy | null>(() => parseCalendarReminderPolicy(event.reminders_json));
  const [providerCapabilities, setProviderCapabilities] = useState<CalendarProviderCapabilities | null>(null);
  const inFlightRef = useRef(false);
  const accounts = useAccountStore((state) => state.accounts);
  const account = accounts.find((item) => item.id === accountId);
  const accountEmail = account?.email ?? "";
  const accountDisplayName = account?.displayName ?? null;
  const calendar = calendars.find((item) => item.id === event.calendar_id);
  const participantSet = useMemo(() => parseCalendarParticipants(event.attendees_json, event.organizer_email), [event.attendees_json, event.organizer_email]);
  const attendees = participantSet.attendees;
  const schedulingParticipants = useMemo(
    () => buildEditorSchedulingParticipants({
      selfEmail: accountEmail,
      selfDisplayName: accountDisplayName,
      attendees,
    }),
    [accountDisplayName, accountEmail, attendees],
  );
  const meetingUrl = useMemo(() => findTelemostUrl(event.description), [event.description]);
  const editTarget = useMemo(() => classifyRecurringEditTarget(event), [event]);
  const recurring = editTarget.kind !== "plain";
  const selfAttendee = findCurrentAttendee(attendees, { accountId, email: accountEmail });
  const updateChoices = useMemo(
    () => recurrenceScopeChoices(providerCapabilities, "update", editTarget),
    [editTarget, providerCapabilities],
  );
  const deleteChoices = useMemo(
    () => recurrenceScopeChoices(providerCapabilities, "delete", editTarget),
    [editTarget, providerCapabilities],
  );
  const canUpdate = canMutateRecurring(providerCapabilities, "update", editTarget);
  const canDelete = canMutateRecurring(providerCapabilities, "delete", editTarget);
  const canRsvp = providerCapabilities?.rsvp.remote === "direct";
  const scopeChoices = pendingIntent === "delete" ? deleteChoices : updateChoices;

  useEffect(() => {
    let current = true;
    void calendarMutationService.capabilities(accountId)
      .then((capabilities) => { if (current) setProviderCapabilities(capabilities); })
      .catch(() => { if (current) setProviderCapabilities(null); });
    return () => { current = false; };
  }, [accountId]);

  const remoteIds = useCallback(() => ({
    calendarRemoteId: calendar?.remote_id ?? "primary",
    remoteEventId: event.remote_event_id ?? event.google_event_id,
  }), [calendar?.remote_id, event.google_event_id, event.remote_event_id]);

  const mutationTarget = useCallback((scope?: RecurrenceWriteScope) => ({
    accountId,
    ...remoteIds(),
    etag: event.etag ?? undefined,
    isRecurring: recurring,
    recurrenceScope: scope,
    seriesUid: editTarget.seriesUid,
    occurrenceKey: scope === "single" ? editTarget.occurrenceKey : undefined,
  }), [accountId, editTarget.occurrenceKey, editTarget.seriesUid, event.etag, recurring, remoteIds]);

  const commitUpdate = useCallback(async (scope?: RecurrenceWriteScope) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusyAction("save"); setError(null);
    try {
      const result = await calendarMutationService.update({
        ...mutationTarget(scope),
        baseSequence: event.sequence,
      }, {
        summary,
        description,
        location,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        isAllDay: event.is_all_day === 1,
        ...(reminders ? { reminders } : {}),
      });
      if (result.status !== "success") {
        setPendingIntent(null);
        setError(writeFailureCopy(result));
        return;
      }
      setPendingIntent(null);
      onUpdated();
    } catch {
      setPendingIntent(null);
      setError("Не удалось выполнить операцию с календарём.");
    } finally {
      inFlightRef.current = false;
      setBusyAction(null);
    }
  }, [description, endTime, event.is_all_day, event.sequence, location, mutationTarget, onUpdated, reminders, startTime, summary]);

  const commitDelete = useCallback(async (scope?: RecurrenceWriteScope) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusyAction("delete"); setError(null);
    try {
      const result = await calendarMutationService.delete(mutationTarget(scope));
      if (result.status !== "success") {
        setPendingIntent(null);
        setError(writeFailureCopy(result));
        return;
      }
      setPendingIntent(null);
      onUpdated();
    } catch {
      setPendingIntent(null);
      setError("Не удалось выполнить операцию с календарём.");
    } finally {
      inFlightRef.current = false;
      setBusyAction(null);
    }
  }, [mutationTarget, onUpdated]);

  const requestSave = useCallback(() => {
    if (busyAction) return;
    if (!recurring) {
      void commitUpdate();
      return;
    }
    setError(null);
    setPendingIntent("update");
  }, [busyAction, commitUpdate, recurring]);

  const requestDelete = useCallback(() => {
    if (busyAction) return;
    if (!recurring) {
      void commitDelete();
      return;
    }
    setConfirmDelete(false);
    setError(null);
    setPendingIntent("delete");
  }, [busyAction, commitDelete, recurring]);

  const handleRsvp = useCallback(async (status: CalendarParticipationStatus) => {
    if (!accountEmail) return;
    setBusyAction("rsvp"); setError(null);
    try {
      const ids = remoteIds();
      const result = await calendarMutationService.respond({
        accountId,
        ...ids,
        etag: event.etag ?? undefined,
      }, accountEmail, status);
      if (result.status !== "success") throw new Error(result.message);
      onUpdated();
    } catch (cause) {
      setError(errorMessage(cause, "Не удалось отправить ответ организатору"));
    } finally { setBusyAction(null); }
  }, [accountEmail, accountId, event.etag, onUpdated, remoteIds]);

  const openMeeting = useCallback(() => {
    if (!meetingUrl) return;
    sessionStorage.setItem("office360_telemost_open_event_id", event.id);
    navigateToLabel("telemost");
    window.setTimeout(() => void cefNavigate(meetingUrl), 150);
  }, [event.id, meetingUrl]);

  const scopeDialog = pendingIntent && scopeChoices.length > 0 ? (
    <RecurrenceScopeDialog
      intent={pendingIntent}
      choices={scopeChoices}
      busy={busyAction !== null}
      onCancel={() => setPendingIntent(null)}
      onConfirm={(scope) => { void (pendingIntent === "delete" ? commitDelete(scope) : commitUpdate(scope)); }}
    />
  ) : null;

  if (editing) {
    return (
      <>
      <Modal isOpen onClose={pendingIntent ? () => undefined : onClose} title="Изменить событие" width="w-full max-w-5xl" panelClassName="max-h-[90vh] overflow-hidden">
        <div className="max-h-[calc(90vh-3.5rem)] space-y-4 overflow-y-auto p-5">
          <TextField label="Название" type="text" value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Начало" type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <TextField label="Окончание" type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
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
          <TextField label="Место" type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Добавить место" />
          <ReminderEditor capabilities={providerCapabilities} value={reminders} onChange={setReminders} />
          <label className="block text-xs text-text-secondary">Описание
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className="mt-1 w-full px-3 py-2 bg-bg-tertiary border border-border-primary rounded text-sm text-text-primary outline-none focus:border-accent resize-y" />
          </label>
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="md" onClick={() => { setPendingIntent(null); setEditing(false); }}>Отмена</Button>
            <Button variant="primary" size="md" onClick={requestSave} disabled={busyAction !== null || !summary.trim()}>{busyAction === "save" ? "Сохранение…" : "Сохранить"}</Button>
          </div>
        </div>
      </Modal>
      {scopeDialog}
      </>
    );
  }

  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const panelLeft = Math.max(12, Math.min((anchor?.x ?? viewportWidth / 2) + 14, viewportWidth - 680));
  const panelTop = Math.max(12, Math.min((anchor?.y ?? viewportHeight / 2) - 90, viewportHeight - 540));

  return createPortal(
    <>
    <div className="fixed inset-0 z-50" onMouseDown={(mouseEvent) => mouseEvent.target === mouseEvent.currentTarget && onClose()}>
      <section
        role="dialog"
        aria-modal="false"
        aria-label={event.summary ?? "Событие"}
        className="fixed w-[min(42rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-border-primary bg-bg-primary shadow-2xl"
        style={{ left: panelLeft, top: panelTop, maxHeight: "calc(100vh - 24px)" }}
        onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-primary px-5 py-3">
          <h2 className="truncate text-base font-semibold text-text-primary">{event.summary ?? "Событие"}</h2>
          <button type="button" className="rounded p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary" onClick={onClose} aria-label="Закрыть"><X size={17} /></button>
        </header>
        <div className="max-h-[calc(100vh-80px)] overflow-y-auto">
      <div className="p-5 space-y-4">
        {event.description && <div className="text-sm leading-5 text-text-secondary"><LinkifiedText text={event.description} /></div>}

        <InfoRow icon={<Clock size={17} />} label="Время и дата">
          <span className="text-text-primary font-medium">{formatEventRange(event)}</span>
          {recurring && <Repeat2 size={15} className="text-text-tertiary" aria-label="Повторяющееся событие" />}
        </InfoRow>
        {event.location && <InfoRow icon={<MapPin size={17} />} label="Место"><span>{event.location}</span></InfoRow>}
        {formatReminderPolicy(reminders) && <InfoRow icon={<Clock size={17} />} label="Напоминания"><span>{formatReminderPolicy(reminders)}</span></InfoRow>}
        {participantSet.organizer && <InfoRow icon={<User size={17} />} label="Организатор"><OrganizerChip organizer={participantSet.organizer} /></InfoRow>}
        {attendees.length > 0 && (
          <InfoRow icon={<User size={17} />} label="Участники">
            <div className="flex flex-wrap gap-2">{attendees.map((attendee) => <PersonChip key={attendee.participant.normalizedEmail ?? attendee.participant.value} attendee={attendee} />)}</div>
          </InfoRow>
        )}
        {calendar && <InfoRow label="Календарь"><span className="inline-flex items-center gap-2"><i className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: calendar.color ?? "var(--color-accent)" }} />{calendar.display_name}</span></InfoRow>}

        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-border-primary">
          <div className="flex items-center gap-2">
            {selfAttendee && canRsvp && (
              <select value={normalizeResponse(selfAttendee.status)} onChange={(e) => void handleRsvp(e.target.value as CalendarParticipationStatus)} disabled={busyAction !== null} className="px-3 py-2 rounded-md bg-bg-tertiary text-sm font-medium text-text-primary border border-border-primary outline-none">
                <option value="accepted">Пойду</option><option value="tentative">Возможно</option><option value="declined">Не пойду</option>
              </select>
            )}
            {meetingUrl && <Button variant="primary" size="md" icon={<ExternalLink size={15} />} onClick={openMeeting}>Открыть в Телемосте</Button>}
            {meetingUrl && <Button variant="secondary" size="md" icon={<Copy size={15} />} onClick={() => void navigator.clipboard.writeText(meetingUrl)}>Копировать ссылку</Button>}
          </div>
          <div className="flex items-center gap-1">
            {event.organizer_email && <Button variant="secondary" size="md" icon={<Mail size={15} />} iconOnly aria-label="Написать организатору" onClick={() => void openUrl(`mailto:${event.organizer_email}`)} />}
            {canDelete && (recurring
              ? <Button variant="ghost" size="md" icon={<Trash2 size={15} />} iconOnly aria-label="Удалить" onClick={requestDelete} disabled={busyAction !== null} />
              : (!confirmDelete
                ? <Button variant="ghost" size="md" icon={<Trash2 size={15} />} iconOnly aria-label="Удалить" onClick={() => setConfirmDelete(true)} />
                : <><Button variant="danger" size="sm" onClick={requestDelete} disabled={busyAction !== null}>{busyAction === "delete" ? "Удаление…" : "Удалить"}</Button><Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>Отмена</Button></>))}
            {canUpdate && <Button variant="secondary" size="md" icon={<Pencil size={15} />} iconOnly aria-label="Изменить" onClick={() => setEditing(true)} />}
          </div>
        </div>
      </div>
        </div>
      </section>
    </div>
    {scopeDialog}
    </>,
    document.body,
  );
}

function InfoRow({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[132px_1fr] gap-3 text-sm"><div className="flex items-center gap-2 text-text-tertiary">{icon}{label}</div><div className="flex items-center gap-2 text-text-secondary min-w-0">{children}</div></div>;
}

function PersonChip({ attendee }: { attendee: CalendarAttendee }) {
  const status = attendee.status;
  const StatusIcon = status === "accepted" || status === "needs-action" ? (status === "accepted" ? Check : CircleHelp) : status === "declined" ? X : Clock;
  const role = attendee.role === "optional" ? "необязательно" : attendee.role === "chair" ? "председатель" : attendee.role === "non-participant" ? "информирование" : null;
  return <span title={attendee.participant.value} className="inline-flex items-center gap-1.5 rounded-full bg-bg-tertiary px-2.5 py-1"><User size={13} /><span>{attendee.participant.displayName ?? attendee.participant.value}</span>{role && <span className="text-text-tertiary">({role})</span>}<StatusIcon size={13} className={status === "accepted" ? "text-success" : status === "declined" ? "text-danger" : "text-text-tertiary"} /></span>;
}
function OrganizerChip({ organizer }: { organizer: CalendarOrganizer }) { return <span title={organizer.participant.value}>{organizer.participant.displayName ?? organizer.participant.value}</span>; }

function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return <>{parts.map((part, index) => /^https?:\/\//.test(part) ? <button key={index} className="text-accent hover:underline break-all text-left" onClick={() => void openUrl(part.replace(/[),.;]+$/, ""))}>{part}</button> : <span key={index} className="whitespace-pre-wrap">{part}</span>)}</>;
}

function ErrorNotice({ children }: { children: ReactNode }) { return <div role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{children}</div>; }

function findTelemostUrl(value: string | null): string | null { return value?.match(/https:\/\/telemost(?:\.360)?\.yandex\.ru\/[^\s]+/i)?.[0]?.replace(/[),.;]+$/, "") ?? null; }
function normalizeResponse(value?: string): CalendarParticipationStatus { return value === "declined" || value === "tentative" ? value : "accepted"; }
function errorMessage(cause: unknown, fallback: string): string { return cause instanceof Error ? `${fallback}: ${cause.message}` : fallback; }

function formatEventRange(event: DbCalendarEvent): string {
  const start = new Date(event.start_time * 1000); const end = new Date(event.end_time * 1000);
  if (event.is_all_day === 1) {
    const [year, month, day] = allDayStartDate(event).split("-").map(Number);
    return new Date(year!, month! - 1, day!).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  const date = start.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const startClock = start.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const endClock = end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${date}, ${startClock} — ${endClock}`;
}

function toLocalISOString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
