import { useMemo, useState, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, CircleHelp, Clock, Copy, ExternalLink, Mail, MapPin, Pencil, Repeat2, Trash2, User, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/TextField";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { DbCalendar } from "@/services/db/calendars";
import type { CalendarParticipationStatus } from "@/services/calendar/types";
import { getCalendarProvider } from "@/services/calendar/providerFactory";
import { deleteCalendarEvent as deleteCalendarEventDb } from "@/services/db/calendarEvents";
import { useAccountStore } from "@/stores/accountStore";
import { navigateToLabel } from "@/router/navigate";
import { cefNavigate } from "@/services/cef";
import { allDayStartDate } from "./eventTimeProjection";

interface EventDetailModalProps {
  event: DbCalendarEvent;
  calendars: DbCalendar[];
  accountId: string;
  anchor?: { x: number; y: number } | null;
  onClose: () => void;
  onUpdated: () => void;
}

interface Attendee {
  email: string;
  displayName?: string;
  responseStatus?: string;
}

export function EventDetailModal({ event, calendars, accountId, anchor, onClose, onUpdated }: EventDetailModalProps) {
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(event.summary ?? "");
  const [description, setDescription] = useState(event.description ?? "");
  const [location, setLocation] = useState(event.location ?? "");
  const [startTime, setStartTime] = useState(toLocalISOString(new Date(event.start_time * 1000)));
  const [endTime, setEndTime] = useState(toLocalISOString(new Date(event.end_time * 1000)));
  const [busyAction, setBusyAction] = useState<"save" | "delete" | "rsvp" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accounts = useAccountStore((state) => state.accounts);
  const accountEmail = accounts.find((account) => account.id === accountId)?.email ?? "";
  const calendar = calendars.find((item) => item.id === event.calendar_id);
  const attendees = useMemo(() => parseAttendees(event.attendees_json), [event.attendees_json]);
  const meetingUrl = useMemo(() => findTelemostUrl(event.description), [event.description]);
  const recurring = event.is_recurrence_master === 1 || event.occurrence_key !== null;
  const selfAttendee = attendees.find((item) => item.email.toLowerCase() === accountEmail.toLowerCase());

  const remoteIds = useCallback(() => ({
    calendarRemoteId: calendar?.remote_id ?? "primary",
    remoteEventId: event.remote_event_id ?? event.google_event_id,
  }), [calendar?.remote_id, event.google_event_id, event.remote_event_id]);

  const handleSave = useCallback(async () => {
    setBusyAction("save"); setError(null);
    try {
      const provider = await getCalendarProvider(accountId);
      const ids = remoteIds();
      await provider.updateEvent(ids.calendarRemoteId, ids.remoteEventId, {
        summary,
        description,
        location,
        startTime: recurring ? undefined : new Date(startTime).toISOString(),
        endTime: recurring ? undefined : new Date(endTime).toISOString(),
        isAllDay: event.is_all_day === 1,
      }, event.etag ?? undefined);
      onUpdated();
    } catch (cause) {
      setError(errorMessage(cause, "Не удалось сохранить событие"));
    } finally { setBusyAction(null); }
  }, [accountId, description, endTime, event.etag, event.is_all_day, location, onUpdated, remoteIds, startTime, summary]);

  const handleDelete = useCallback(async () => {
    setBusyAction("delete"); setError(null);
    try {
      const provider = await getCalendarProvider(accountId);
      const ids = remoteIds();
      await provider.deleteEvent(ids.calendarRemoteId, ids.remoteEventId, event.etag ?? undefined);
      await deleteCalendarEventDb(event.id);
      onUpdated();
    } catch (cause) {
      setError(errorMessage(cause, "Не удалось удалить событие"));
    } finally { setBusyAction(null); }
  }, [accountId, event.etag, event.id, onUpdated, remoteIds]);

  const handleRsvp = useCallback(async (status: CalendarParticipationStatus) => {
    if (!accountEmail) return;
    setBusyAction("rsvp"); setError(null);
    try {
      const provider = await getCalendarProvider(accountId);
      if (!provider.respondToEvent) throw new Error("Ответы на приглашения не поддерживаются этим календарём");
      const ids = remoteIds();
      await provider.respondToEvent(ids.calendarRemoteId, ids.remoteEventId, accountEmail, status, event.etag ?? undefined);
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

  if (editing) {
    return (
      <Modal isOpen onClose={onClose} title="Изменить событие" width="w-full max-w-xl">
        <div className="p-5 space-y-4">
          {recurring && <Notice>Изменения будут применены ко всей серии повторяющихся событий.</Notice>}
          <TextField label="Название" type="text" value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Начало" type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={recurring} />
            <TextField label="Окончание" type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={recurring} />
          </div>
          <TextField label="Место" type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Добавить место" />
          <label className="block text-xs text-text-secondary">Описание
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className="mt-1 w-full px-3 py-2 bg-bg-tertiary border border-border-primary rounded text-sm text-text-primary outline-none focus:border-accent resize-y" />
          </label>
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="md" onClick={() => setEditing(false)}>Отмена</Button>
            <Button variant="primary" size="md" onClick={handleSave} disabled={busyAction !== null || !summary.trim()}>{busyAction === "save" ? "Сохранение…" : "Сохранить"}</Button>
          </div>
        </div>
      </Modal>
    );
  }

  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const panelLeft = Math.max(12, Math.min((anchor?.x ?? viewportWidth / 2) + 14, viewportWidth - 680));
  const panelTop = Math.max(12, Math.min((anchor?.y ?? viewportHeight / 2) - 90, viewportHeight - 540));

  return createPortal(
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
        {event.organizer_email && <InfoRow icon={<User size={17} />} label="Организатор"><PersonChip attendee={{ email: event.organizer_email }} /></InfoRow>}
        {attendees.length > 0 && (
          <InfoRow icon={<User size={17} />} label="Участники">
            <div className="flex flex-wrap gap-2">{attendees.map((attendee) => <PersonChip key={attendee.email} attendee={attendee} />)}</div>
          </InfoRow>
        )}
        {calendar && <InfoRow label="Календарь"><span className="inline-flex items-center gap-2"><i className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: calendar.color ?? "var(--color-accent)" }} />{calendar.display_name}</span></InfoRow>}

        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-border-primary">
          <div className="flex items-center gap-2">
            {selfAttendee && (
              <select value={normalizeResponse(selfAttendee.responseStatus)} onChange={(e) => void handleRsvp(e.target.value as CalendarParticipationStatus)} disabled={busyAction !== null} className="px-3 py-2 rounded-md bg-bg-tertiary text-sm font-medium text-text-primary border border-border-primary outline-none">
                <option value="accepted">Пойду</option><option value="tentative">Возможно</option><option value="declined">Не пойду</option>
              </select>
            )}
            {meetingUrl && <Button variant="primary" size="md" icon={<ExternalLink size={15} />} onClick={openMeeting}>Открыть в Телемосте</Button>}
            {meetingUrl && <Button variant="secondary" size="md" icon={<Copy size={15} />} onClick={() => void navigator.clipboard.writeText(meetingUrl)}>Копировать ссылку</Button>}
          </div>
          <div className="flex items-center gap-1">
            {event.organizer_email && <Button variant="secondary" size="md" icon={<Mail size={15} />} iconOnly aria-label="Написать организатору" onClick={() => void openUrl(`mailto:${event.organizer_email}`)} />}
            {!confirmDelete ? <Button variant="ghost" size="md" icon={<Trash2 size={15} />} iconOnly aria-label="Удалить" onClick={() => setConfirmDelete(true)} /> : <><Button variant="danger" size="sm" onClick={handleDelete} disabled={busyAction !== null}>{busyAction === "delete" ? "Удаление…" : "Удалить"}</Button><Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>Отмена</Button></>}
            <Button variant="secondary" size="md" icon={<Pencil size={15} />} iconOnly aria-label="Изменить" onClick={() => setEditing(true)} />
          </div>
        </div>
      </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function InfoRow({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[132px_1fr] gap-3 text-sm"><div className="flex items-center gap-2 text-text-tertiary">{icon}{label}</div><div className="flex items-center gap-2 text-text-secondary min-w-0">{children}</div></div>;
}

function PersonChip({ attendee }: { attendee: Attendee }) {
  const status = attendee.responseStatus?.toLowerCase();
  const StatusIcon = status === "accepted" || status === "needs-action" ? (status === "accepted" ? Check : CircleHelp) : status === "declined" ? X : Clock;
  return <span title={attendee.email} className="inline-flex items-center gap-1.5 rounded-full bg-bg-tertiary px-2.5 py-1"><User size={13} /><span>{attendee.displayName ?? attendee.email}</span><StatusIcon size={13} className={status === "accepted" ? "text-success" : status === "declined" ? "text-danger" : "text-text-tertiary"} /></span>;
}

function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return <>{parts.map((part, index) => /^https?:\/\//.test(part) ? <button key={index} className="text-accent hover:underline break-all text-left" onClick={() => void openUrl(part.replace(/[),.;]+$/, ""))}>{part}</button> : <span key={index} className="whitespace-pre-wrap">{part}</span>)}</>;
}

function Notice({ children }: { children: ReactNode }) { return <div className="rounded-md bg-accent/10 px-3 py-2 text-xs text-text-secondary">{children}</div>; }
function ErrorNotice({ children }: { children: ReactNode }) { return <div role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{children}</div>; }

function parseAttendees(value: string | null): Attendee[] { try { return value ? JSON.parse(value) as Attendee[] : []; } catch { return []; } }
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
