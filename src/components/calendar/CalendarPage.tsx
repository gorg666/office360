import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { getCalendarsForAccount, upsertCalendar, type DbCalendar } from "@/services/db/calendars";
import { getCalendarProvider } from "@/services/calendar/providerFactory";
import { calendarSyncService } from "@/services/calendar/calendarSyncService";
import { calendarMutationService } from "@/services/calendar/calendarMutationService";
import { parseCalendarAccess, type CalendarProviderCapabilities } from "@/services/calendar/domain";
import type { CalendarReadDiagnostics, CreateEventInput } from "@/services/calendar/types";
import { CalendarToolbar, type CalendarView } from "./CalendarToolbar";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";
import { DayView } from "./DayView";
import { EventCreateModal, type EventCreateInput } from "./EventCreateModal";
import { authoredParticipantsToInputs, hydrateAuthoredParticipants } from "./participants/authoredParticipants";
import { EventDetailModal } from "./EventDetailModal";
import { CalendarList } from "./CalendarList";
import { CalendarReauthBanner } from "./CalendarReauthBanner";
import { RecurrenceScopeDialog } from "./recurrence/RecurrenceScopeDialog";
import {
  classifyRecurringEditTarget,
  dragResizeFailureCopy,
  recurrenceScopeChoices,
} from "./recurrence/recurrenceEditScope";
import {
  commitTimedGridMutation,
  overrideFromTimedDraft,
  type TimedDraft,
  type TimedVisualOverride,
} from "./timedGrid";
import {
  applyDateGridDraft,
  commitDateGridMutation,
  overrideFromDateGrid,
  type DateGridDraft,
} from "./dateGrid";
import { toEventCreateInput, type GridCreateDraft } from "./createSelection";
import { Button } from "@/components/ui/Button";
import type { RecurrenceWriteScope } from "@/services/calendar/domain";
import { useUIStore } from "@/stores/uiStore";
import { endOfWeek, monthGridRange, startOfWeek } from "./weekLocale";
import { CalendarSearch } from "./CalendarSearch";
import { CalendarAclDialog } from "./CalendarAclDialog";

type CalendarLoadState =
  | { status: "loading" }
  | ({ status: "fresh" } & CalendarReadDiagnostics)
  | { status: "stale" }
  | { status: "error" };

type PendingGridMutation =
  | { kind: "timed"; event: DbCalendarEvent; draft: TimedDraft }
  | { kind: "date"; event: DbCalendarEvent; draft: DateGridDraft };

export function CalendarPage() {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const accounts = useAccountStore((s) => s.accounts);
  const locale = useUIStore((state) => state.locale);
  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<CalendarView>("month");
  const [events, setEvents] = useState<DbCalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<DbCalendar[]>([]);
  const [loadState, setLoadState] = useState<CalendarLoadState>({ status: "loading" });
  const [showCreate, setShowCreate] = useState(false);
  const [createInitialValues, setCreateInitialValues] = useState<Partial<EventCreateInput> | undefined>();
  const [selectedEvent, setSelectedEvent] = useState<DbCalendarEvent | null>(null);
  const [eventAnchor, setEventAnchor] = useState<{ x: number; y: number } | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [showCalendarList, setShowCalendarList] = useState(false);
  const [sharingCalendar, setSharingCalendar] = useState<DbCalendar | null>(null);
  const [hasCalendar, setHasCalendar] = useState(true);
  const [providerCapabilities, setProviderCapabilities] = useState<CalendarProviderCapabilities | null>(null);
  const [pendingEventIds, setPendingEventIds] = useState<ReadonlySet<string>>(() => new Set());
  const [visualOverrides, setVisualOverrides] = useState<Readonly<Record<string, TimedVisualOverride>>>({});
  const [timedGesture, setTimedGesture] = useState<PendingGridMutation | null>(null);
  const [timedError, setTimedError] = useState<string | null>(null);
  const [timedBusy, setTimedBusy] = useState(false);
  const reauthDoneRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const timedInFlightRef = useRef(new Set<string>());
  const timedGestureRef = useRef<PendingGridMutation | null>(null);
  const calendarApiEnableUrl =
    "https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com";
  const writableCalendars = useMemo(
    () => calendars.filter((calendar) => parseCalendarAccess(calendar.access_json).permissions.canCreate),
    [calendars],
  );
  const searchableCalendars = useMemo(
    () => calendars.filter((calendar) => {
      const permissions = parseCalendarAccess(calendar.access_json).permissions;
      return permissions.canRead && permissions.canSeeEventDetails;
    }),
    [calendars],
  );
  const canCreateEvent = providerCapabilities?.events.create === "remote" && writableCalendars.length > 0;
  const canUpdateEvent = useCallback((event: DbCalendarEvent) => {
    const calendar = calendars.find((candidate) => candidate.id === event.calendar_id);
    return parseCalendarAccess(calendar?.access_json).permissions.canUpdate;
  }, [calendars]);

  const getRange = useCallback((): { start: Date; end: Date } => {
    const d = new Date(currentDate);
    if (view === "month") {
      return monthGridRange(d, locale);
    }
    if (view === "week") {
      const start = startOfWeek(d, locale);
      const end = endOfWeek(d, locale);
      return { start, end };
    }
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, [currentDate, locale, view]);

  const loadCalendars = useCallback(async () => {
    if (!activeAccountId) return;
    try {
      const cals = await getCalendarsForAccount(activeAccountId);
      setCalendars(cals);
    } catch {
      // ignore
    }
  }, [activeAccountId]);

  const loadEvents = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    if (!activeAccountId) return;
    const isCurrent = () => loadGenerationRef.current === generation;
    setLoadState({ status: "loading" });
    setNeedsReauth(false);
    setCalendarError(null);

    const { start, end } = getRange();
    const result = await calendarSyncService.loadRange({
      accountId: activeAccountId,
      rangeStart: start,
      rangeEnd: end,
      onCache: (snapshot) => {
        if (!isCurrent()) return;
        setEvents(snapshot.events);
        setCalendars(snapshot.calendars);
      },
    });
    if (!isCurrent()) return;

    setHasCalendar(result.hasCalendar);
    setEvents(result.events);
    setCalendars(result.calendars);
    setNeedsReauth(false);
    setCalendarError(null);

    if (result.status === "fresh" || result.status === "fresh-with-warnings") {
      setLoadState({ status: "fresh", ...result.diagnostics });
      return;
    }

    setLoadState({ status: result.status });
    if (result.errorCategory === "calendar-api-disabled" || result.errorCategory === "permission") {
      if (result.errorCategory === "calendar-api-disabled") {
          setNeedsReauth(false);
          setCalendarError(
            "Google Calendar API выключен в проекте Google Cloud. " +
            "Откройте Google Cloud Console и включите Google Calendar API для проекта с вашим Client ID.",
          );
      } else if (reauthDoneRef.current) {
          reauthDoneRef.current = false;
          setCalendarError(
            "Доступ к календарю всё ещё запрещён после повторной авторизации. " +
            "Включите Google Calendar API в проекте Google Cloud Console: " +
            "APIs & Services -> Library -> Google Calendar API -> Enable.",
          );
      } else {
          setNeedsReauth(true);
      }
    }
  }, [activeAccountId, getRange]);

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, currentDate, view]);

  useEffect(() => {
    let current = true;
    setProviderCapabilities(null);
    if (!activeAccountId) return () => { current = false; };
    void calendarMutationService.capabilities(activeAccountId)
      .then((capabilities) => { if (current) setProviderCapabilities(capabilities); })
      .catch(() => { if (current) setProviderCapabilities(null); });
    return () => { current = false; };
  }, [activeAccountId]);

  const handlePrev = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      if (view === "month") next.setMonth(next.getMonth() - 1);
      else if (view === "week") next.setDate(next.getDate() - 7);
      else next.setDate(next.getDate() - 1);
      return next;
    });
  }, [view]);

  const handleNext = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      if (view === "month") next.setMonth(next.getMonth() + 1);
      else if (view === "week") next.setDate(next.getDate() + 7);
      else next.setDate(next.getDate() + 1);
      return next;
    });
  }, [view]);

  const handleToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const handleCreateEvent = useCallback(async (eventData: EventCreateInput) => {
    if (!activeAccountId) return;
    try {
      const provider = await getCalendarProvider(activeAccountId);
      let availableCalendars = calendars;

      if (availableCalendars.length === 0) {
        const providerCalendars = await provider.listCalendars();
        for (const cal of providerCalendars) {
          await upsertCalendar({
            accountId: activeAccountId,
            provider: provider.type,
            remoteId: cal.remoteId,
            displayName: cal.displayName,
            color: cal.color,
            isPrimary: cal.isPrimary,
            access: cal.access,
            observedAt: Math.floor(Date.now() / 1000),
          });
        }
        availableCalendars = await getCalendarsForAccount(activeAccountId);
        setCalendars(availableCalendars);
      }
      availableCalendars = availableCalendars.filter((calendar) => parseCalendarAccess(calendar.access_json).permissions.canCreate);

      // Find the target calendar
      let calendarRemoteId: string | undefined;
      if (eventData.calendarId) {
        const cal = availableCalendars.find((c) => c.id === eventData.calendarId);
        if (cal) {
          calendarRemoteId = cal.remote_id;
        }
      }

      // Fallback to primary calendar
      if (!calendarRemoteId) {
        const primary = availableCalendars.find((c) => c.is_primary) ?? availableCalendars[0];
        if (primary) {
          calendarRemoteId = primary.remote_id;
        }
      }

      if (!calendarRemoteId) {
        if (provider.type !== "google_api") {
          throw new Error("Не найден календарь для создания события. Обновите список календарей и попробуйте ещё раз.");
        }
        calendarRemoteId = "primary";
      }

      const input: CreateEventInput = {
        summary: eventData.summary,
        description: eventData.description || undefined,
        location: eventData.location || undefined,
        startTime: eventData.startTime,
        endTime: eventData.endTime,
        attendees: authoredParticipantsToInputs(eventData.attendees),
        isAllDay: eventData.allDay,
        time: eventData.time,
        reminders: eventData.reminders,
        recurrenceRule: eventData.recurrenceRule,
      };

      const result = await calendarMutationService.create(activeAccountId, calendarRemoteId, input);
      if (result.status !== "success") throw new Error(result.message);

      setShowCreate(false);
      setCreateInitialValues(undefined);
      loadEvents();
    } catch (err) {
      const safeMessage = err instanceof Error && /[А-Яа-яЁё]/.test(err.message)
        ? err.message
        : "Не удалось создать событие. Обновите календарь и повторите попытку.";
      throw new Error(safeMessage);
    }
  }, [activeAccountId, calendars, loadEvents]);

  const displayTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const handleGridCreate = useCallback((draft: GridCreateDraft) => {
    if (providerCapabilities?.events.create !== "remote") return;
    const values = toEventCreateInput(draft, displayTimeZone);
    setCreateInitialValues({
      startTime: values.startTime,
      endTime: values.endTime,
      allDay: values.allDay,
      time: values.time,
      attendees: hydrateAuthoredParticipants(values.attendees),
    });
    setShowCreate(true);
  }, [displayTimeZone, providerCapabilities]);

  const handleEventClick = useCallback((event: DbCalendarEvent, anchor: { x: number; y: number }) => {
    if (timedInFlightRef.current.has(event.id)) return;
    setSelectedEvent(event);
    setEventAnchor(anchor);
  }, []);

  const handleSearchEventOpen = useCallback((event: DbCalendarEvent) => {
    setSelectedEvent(event);
    setEventAnchor({ x: Math.round(window.innerWidth * 0.55), y: Math.round(window.innerHeight * 0.4) });
  }, []);

  const clearTimedOverride = useCallback((eventId: string) => {
    timedInFlightRef.current.delete(eventId);
    setPendingEventIds(new Set(timedInFlightRef.current));
    setVisualOverrides((current) => {
      if (!(eventId in current)) return current;
      const next = { ...current };
      delete next[eventId];
      return next;
    });
  }, []);

  const runTimedMutation = useCallback(async (
    event: DbCalendarEvent,
    draft: TimedDraft,
    scope?: RecurrenceWriteScope,
  ) => {
    if (!activeAccountId) return;
    setTimedError(null);
    setTimedBusy(true);
    try {
      const result = await commitTimedGridMutation({
        accountId: activeAccountId,
        event,
        calendars,
        draft,
        scope,
      });
      if (result.status !== "success") {
        clearTimedOverride(event.id);
        setTimedGesture(null);
        timedGestureRef.current = null;
        setTimedError(dragResizeFailureCopy(result));
        return;
      }
      clearTimedOverride(event.id);
      setTimedGesture(null);
      timedGestureRef.current = null;
      await loadEvents();
    } catch {
      clearTimedOverride(event.id);
      setTimedGesture(null);
      timedGestureRef.current = null;
      setTimedError("Не удалось выполнить операцию с календарём.");
    } finally {
      setTimedBusy(false);
    }
  }, [activeAccountId, calendars, clearTimedOverride, loadEvents]);

  const runDateMutation = useCallback(async (
    event: DbCalendarEvent,
    draft: DateGridDraft,
    scope?: RecurrenceWriteScope,
  ) => {
    if (!activeAccountId) return;
    setTimedError(null);
    setTimedBusy(true);
    try {
      const result = await commitDateGridMutation({
        accountId: activeAccountId,
        event,
        calendars,
        draft,
        scope,
      });
      if (result.status !== "success") {
        clearTimedOverride(event.id);
        setTimedGesture(null);
        timedGestureRef.current = null;
        setTimedError(dragResizeFailureCopy(result));
        return;
      }
      clearTimedOverride(event.id);
      setTimedGesture(null);
      timedGestureRef.current = null;
      await loadEvents();
    } catch {
      clearTimedOverride(event.id);
      setTimedGesture(null);
      timedGestureRef.current = null;
      setTimedError("Не удалось выполнить операцию с календарём.");
    } finally {
      setTimedBusy(false);
    }
  }, [activeAccountId, calendars, clearTimedOverride, loadEvents]);

  const beginPendingMutation = useCallback((
    event: DbCalendarEvent,
    override: TimedVisualOverride,
    pending: PendingGridMutation,
    commit: () => void,
  ) => {
    if (timedInFlightRef.current.has(event.id)) return;
    timedInFlightRef.current.add(event.id);
    setPendingEventIds(new Set(timedInFlightRef.current));
    setVisualOverrides((current) => ({ ...current, [event.id]: override }));
    setTimedError(null);
    setSelectedEvent(null);
    const target = classifyRecurringEditTarget(event);
    const choices = recurrenceScopeChoices(providerCapabilities, "update", target);
    if (choices.length > 0) {
      timedGestureRef.current = pending;
      setTimedGesture(pending);
      return;
    }
    commit();
  }, [providerCapabilities]);

  const handleTimedCommit = useCallback((
    event: DbCalendarEvent,
    draft: TimedDraft,
    _anchor: { x: number; y: number },
  ) => {
    const override = overrideFromTimedDraft(event, draft);
    if (!override) return;
    beginPendingMutation(event, override, { kind: "timed", event, draft }, () => {
      void runTimedMutation(event, draft);
    });
  }, [beginPendingMutation, runTimedMutation]);

  const handleDateCommit = useCallback((
    event: DbCalendarEvent,
    draft: DateGridDraft,
    _anchor: { x: number; y: number },
  ) => {
    const applied = applyDateGridDraft(event, draft);
    if (!applied.ok || applied.unchanged) return;
    const override = overrideFromDateGrid(applied.time);
    beginPendingMutation(event, override, { kind: "date", event, draft }, () => {
      void runDateMutation(event, draft);
    });
  }, [beginPendingMutation, runDateMutation]);

  const handleTimedScopeCancel = useCallback(() => {
    const pending = timedGestureRef.current;
    timedGestureRef.current = null;
    setTimedGesture(null);
    if (pending) clearTimedOverride(pending.event.id);
  }, [clearTimedOverride]);

  const handleTimedScopeConfirm = useCallback((scope: RecurrenceWriteScope) => {
    const pending = timedGestureRef.current;
    if (!pending) return;
    if (pending.kind === "timed") {
      void runTimedMutation(pending.event, pending.draft, scope);
      return;
    }
    void runDateMutation(pending.event, pending.draft, scope);
  }, [runDateMutation, runTimedMutation]);

  const handleEventUpdated = useCallback(() => {
    setSelectedEvent(null);
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    const rawDraft = sessionStorage.getItem("office360_calendar_create_draft");
    if (!rawDraft) return;
    sessionStorage.removeItem("office360_calendar_create_draft");
    try {
      setCreateInitialValues(JSON.parse(rawDraft) as Partial<EventCreateInput>);
      setShowCreate(true);
    } catch {
      setCreateInitialValues(undefined);
    }
  }, []);

  useEffect(() => {
    const requestedId = sessionStorage.getItem("office360_calendar_open_event_id");
    if (!requestedId || events.length === 0) return;
    const requestedEvent = events.find((event) => event.id === requestedId);
    if (!requestedEvent) return;
    sessionStorage.removeItem("office360_calendar_open_event_id");
    setCurrentDate(new Date(requestedEvent.start_time * 1000));
    setSelectedEvent(requestedEvent);
    setEventAnchor({ x: Math.round(window.innerWidth * 0.55), y: Math.round(window.innerHeight * 0.45) });
  }, [events]);

  if (!activeAccountId) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        Подключите аккаунт, чтобы использовать календарь
      </div>
    );
  }

  if (!hasCalendar) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        <div className="text-center">
          <p>Календарь не настроен для этого аккаунта.</p>
          <p className="mt-1 text-xs">Для IMAP-аккаунтов настройте CalDAV в параметрах.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden bg-bg-primary">
      <CalendarToolbar
        currentDate={currentDate}
        view={view}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        onViewChange={setView}
        onCreateEvent={() => { setCreateInitialValues(undefined); setShowCreate(true); }}
        canCreateEvent={canCreateEvent}
        onToggleCalendarList={() => setShowCalendarList((v) => !v)}
        showCalendarListButton={calendars.length > 1}
        search={(
          <CalendarSearch
            accountId={activeAccountId}
            calendars={searchableCalendars}
            currentRange={{
              start: Math.floor(getRange().start.getTime() / 1000),
              end: Math.ceil(getRange().end.getTime() / 1000),
            }}
            locale={locale}
            onOpenEvent={handleSearchEventOpen}
          />
        )}
      />

      {needsReauth && activeAccount && (
        <CalendarReauthBanner
          accountId={activeAccount.id}
          email={activeAccount.email}
          hasCachedData={loadState.status === "stale"}
          onReauthSuccess={() => {
            reauthDoneRef.current = true;
            setNeedsReauth(false);
            setCalendarError(null);
            loadEvents();
          }}
        />
      )}

      {(loadState.status === "stale" || loadState.status === "error") && !needsReauth && (
        <div
          role={loadState.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`mx-6 my-4 p-4 rounded-lg border flex items-start gap-3 ${
            loadState.status === "stale"
              ? "bg-warning/10 border-warning/30"
              : "bg-danger/10 border-danger/30"
          }`}
        >
          <AlertTriangle
            size={18}
            aria-hidden="true"
            className={`shrink-0 mt-0.5 ${loadState.status === "stale" ? "text-warning" : "text-danger"}`}
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-text-primary">
              {loadState.status === "stale"
                ? "Не удалось обновить календарь"
                : "Не удалось загрузить календарь"}
            </p>
            <p className="text-xs text-text-secondary mt-1">
              {loadState.status === "stale"
                ? "Показаны ранее загруженные данные."
                : "События недоступны. Проверьте подключение и повторите попытку."}
            </p>
            {calendarError && (
              <p className="text-xs text-text-secondary mt-1.5">{calendarError}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="primary"
                size="xs"
                icon={<RefreshCw size={12} aria-hidden="true" />}
                onClick={() => void loadEvents()}
              >
                Повторить
              </Button>
              {calendarError && (
                <Button
                  type="button"
                  size="xs"
                  onClick={async () => {
                    const { openUrl } = await import("@tauri-apps/plugin-opener");
                    await openUrl(calendarApiEnableUrl);
                  }}
                >
                  Открыть Google Calendar API
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {loadState.status === "fresh"
        && (loadState.unreadableComponentCount > 0 || loadState.unreadableObjectCount > 0) && (
        <div
          role="status"
          aria-live="polite"
          className="mx-6 my-2 p-3 rounded-lg border border-warning/30 bg-warning/10 flex items-start gap-2"
        >
          <AlertTriangle size={16} aria-hidden="true" className="shrink-0 mt-0.5 text-warning" />
          <div>
            <p className="text-sm font-medium text-text-primary">
              Календарь загружен, но часть событий не удалось прочитать
            </p>
            <p className="text-xs text-text-secondary mt-1">
              Корректные события показаны; непрочитанные данные будут повторно проверены при следующем обновлении.
            </p>
          </div>
        </div>
      )}

      {timedError && (
        <div
          role="alert"
          data-testid="timed-mutation-error"
          className="mx-6 my-2 p-3 rounded-lg border border-danger/30 bg-danger/10"
        >
          <p className="text-sm text-text-primary">{timedError}</p>
        </div>
      )}

      {loadState.status === "loading" && events.length === 0 && (
        <div role="status" className="flex-1 flex items-center justify-center gap-2 text-text-tertiary text-sm">
          <Loader2 size={16} aria-hidden="true" className="animate-spin" />
          Загрузка календаря…
        </div>
      )}

      {loadState.status === "loading" && events.length > 0 && (
        <div role="status" className="mx-6 my-2 flex items-center gap-2 text-xs text-text-tertiary">
          <Loader2 size={13} aria-hidden="true" className="animate-spin" />
          Обновление календаря…
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {showCalendarList && calendars.length > 1 && (
          <CalendarList
            calendars={calendars}
            onManageSharing={setSharingCalendar}
            onVisibilityChange={async (calendarId, visible) => {
              const { setCalendarVisibility } = await import("@/services/db/calendars");
              await setCalendarVisibility(calendarId, visible);
              await loadCalendars();
              loadEvents();
            }}
          />
        )}

        {sharingCalendar && (
          <CalendarAclDialog
            accountId={activeAccountId}
            calendar={sharingCalendar}
            onClose={() => setSharingCalendar(null)}
            onPermissionsRefreshed={loadCalendars}
          />
        )}

        <div className="flex-1 min-w-0">
          {view === "month" && (
            <MonthView
              currentDate={currentDate}
              events={events}
              displayTimeZone={displayTimeZone}
              onEventClick={handleEventClick}
              capabilities={providerCapabilities}
              pendingEventIds={pendingEventIds}
              visualOverrides={visualOverrides}
              onDateCommit={handleDateCommit}
              onCreateDraft={canCreateEvent ? handleGridCreate : undefined}
              canUpdateEvent={canUpdateEvent}
            />
          )}
          {view === "week" && (
            <WeekView
              currentDate={currentDate}
              events={events}
              displayTimeZone={displayTimeZone}
              onEventClick={handleEventClick}
              capabilities={providerCapabilities}
              pendingEventIds={pendingEventIds}
              visualOverrides={visualOverrides}
              onTimedCommit={handleTimedCommit}
              onDateCommit={handleDateCommit}
              onCreateDraft={canCreateEvent ? handleGridCreate : undefined}
              canUpdateEvent={canUpdateEvent}
            />
          )}
          {view === "day" && (
            <DayView
              currentDate={currentDate}
              events={events}
              displayTimeZone={displayTimeZone}
              onEventClick={handleEventClick}
              capabilities={providerCapabilities}
              pendingEventIds={pendingEventIds}
              visualOverrides={visualOverrides}
              onTimedCommit={handleTimedCommit}
              onDateCommit={handleDateCommit}
              onCreateDraft={canCreateEvent ? handleGridCreate : undefined}
              canUpdateEvent={canUpdateEvent}
            />
          )}
        </div>
      </div>

      {showCreate && (
        <EventCreateModal
          calendars={writableCalendars}
          initialValues={createInitialValues}
          accountId={activeAccountId}
          selfEmail={activeAccount?.email ?? null}
          selfDisplayName={activeAccount?.displayName ?? null}
          timeZone={displayTimeZone}
          capabilities={providerCapabilities}
          onClose={() => { setShowCreate(false); setCreateInitialValues(undefined); }}
          onCreate={handleCreateEvent}
        />
      )}

      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          calendars={calendars}
          accountId={activeAccountId}
          anchor={eventAnchor}
          onClose={() => setSelectedEvent(null)}
          onUpdated={handleEventUpdated}
        />
      )}

      {timedGesture && (
        <RecurrenceScopeDialog
          intent="update"
          choices={recurrenceScopeChoices(
            providerCapabilities,
            "update",
            classifyRecurringEditTarget(timedGesture.event),
          )}
          busy={timedBusy}
          onCancel={handleTimedScopeCancel}
          onConfirm={handleTimedScopeConfirm}
        />
      )}
    </div>
  );
}
