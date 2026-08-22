import { useState, useEffect, useCallback, useRef } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { deleteCalendarEventsInRange, getCalendarEventsInRangeMulti, upsertCalendarEvent, type DbCalendarEvent } from "@/services/db/calendarEvents";
import { getVisibleCalendars, getCalendarsForAccount, upsertCalendar, type DbCalendar } from "@/services/db/calendars";
import { getCalendarProvider, hasCalendarSupport } from "@/services/calendar/providerFactory";
import type { CalendarEventData, CalendarReadDiagnostics, CreateEventInput } from "@/services/calendar/types";
import { CalendarToolbar, type CalendarView } from "./CalendarToolbar";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";
import { DayView } from "./DayView";
import { EventCreateModal, type EventCreateInput } from "./EventCreateModal";
import { EventDetailModal } from "./EventDetailModal";
import { CalendarList } from "./CalendarList";
import { CalendarReauthBanner } from "./CalendarReauthBanner";
import { Button } from "@/components/ui/Button";

type CalendarLoadState =
  | { status: "loading" }
  | ({ status: "fresh" } & CalendarReadDiagnostics)
  | { status: "stale" }
  | { status: "error" };

export function CalendarPage() {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const accounts = useAccountStore((s) => s.accounts);
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
  const [hasCalendar, setHasCalendar] = useState(true);
  const reauthDoneRef = useRef(false);
  const calendarApiEnableUrl =
    "https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com";

  const getRange = useCallback((): { start: Date; end: Date } => {
    const d = new Date(currentDate);
    if (view === "month") {
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      end.setDate(end.getDate() + (6 - end.getDay()));
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (view === "week") {
      const start = new Date(d);
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, [currentDate, view]);

  const loadCalendars = useCallback(async () => {
    if (!activeAccountId) return;
    try {
      const supported = await hasCalendarSupport(activeAccountId);
      setHasCalendar(supported);
      if (!supported) return;

      const cals = await getCalendarsForAccount(activeAccountId);
      setCalendars(cals);
    } catch {
      // ignore
    }
  }, [activeAccountId]);

  const loadEvents = useCallback(async () => {
    if (!activeAccountId) return;
    setLoadState({ status: "loading" });
    setNeedsReauth(false);
    setCalendarError(null);

    const { start, end } = getRange();
    const startTs = Math.floor(start.getTime() / 1000);
    const endTs = Math.floor(end.getTime() / 1000);

    let hasUsableCache = false;

    // Load from local cache first. An empty result is not treated as usable
    // because the current schema has no cache-completeness marker for a range.
    try {
      const visibleCals = await getVisibleCalendars(activeAccountId);
      const calendarIds = visibleCals.map((c) => c.id);
      const cached = await getCalendarEventsInRangeMulti(activeAccountId, calendarIds, startTs, endTs);
      setEvents(cached);
      hasUsableCache = cached.length > 0;
    } catch {
      // ignore cache errors
    }

    // Fetch from provider API
    try {
      const supported = await hasCalendarSupport(activeAccountId);
      if (!supported) {
        setLoadState({ status: "fresh", unreadableComponentCount: 0, unreadableObjectCount: 0 });
        return;
      }

      const provider = await getCalendarProvider(activeAccountId);

      // Discover/update calendars
      const providerCalendars = await provider.listCalendars();
      for (const cal of providerCalendars) {
        await upsertCalendar({
          accountId: activeAccountId,
          provider: provider.type,
          remoteId: cal.remoteId,
          displayName: cal.displayName,
          color: cal.color,
          isPrimary: cal.isPrimary,
        });
      }

      // Reload calendars from DB
      const allCals = await getCalendarsForAccount(activeAccountId);
      setCalendars(allCals);

      // Fetch events for visible calendars
      const visibleCals = await getVisibleCalendars(activeAccountId);
      const readDiagnostics: CalendarReadDiagnostics = {
        unreadableComponentCount: 0,
        unreadableObjectCount: 0,
      };
      for (const cal of visibleCals) {
        const apiEvents = await provider.fetchEvents(
          cal.remote_id,
          start.toISOString(),
          end.toISOString(),
        );

        const calendarDiagnostics = provider.lastReadDiagnostics ?? {
          unreadableComponentCount: 0,
          unreadableObjectCount: 0,
        };
        readDiagnostics.unreadableComponentCount += calendarDiagnostics.unreadableComponentCount;
        readDiagnostics.unreadableObjectCount += calendarDiagnostics.unreadableObjectCount;

        if (
          calendarDiagnostics.unreadableComponentCount === 0
          && calendarDiagnostics.unreadableObjectCount === 0
        ) {
          await deleteCalendarEventsInRange(activeAccountId, cal.id, startTs, endTs);
        }

        for (const event of apiEvents) {
          await upsertCalendarEventFromProvider(activeAccountId, cal.id, event);
        }
      }

      // Reload events from DB
      const calendarIds = visibleCals.map((c) => c.id);
      const fresh = await getCalendarEventsInRangeMulti(activeAccountId, calendarIds, startTs, endTs);
      setEvents(fresh);
      setNeedsReauth(false);
      setCalendarError(null);
      setLoadState({ status: "fresh", ...readDiagnostics });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const lowerMessage = message.toLowerCase();
      const isCalendarApiDisabled =
        lowerMessage.includes("service_disabled") ||
        lowerMessage.includes("not been used") ||
        lowerMessage.includes("not enabled") ||
        lowerMessage.includes("accessnotconfigured");
      setLoadState({ status: hasUsableCache ? "stale" : "error" });
      if (message.includes("403") || message.includes("insufficient")) {
        if (isCalendarApiDisabled) {
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
    }
  }, [activeAccountId, getRange]);

  useEffect(() => {
    loadCalendars();
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, currentDate, view]);

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
          });
        }
        availableCalendars = await getCalendarsForAccount(activeAccountId);
        setCalendars(availableCalendars);
      }

      // Find the target calendar
      let calendarRemoteId: string | undefined;
      let calendarDbId: string | undefined;
      if (eventData.calendarId) {
        const cal = availableCalendars.find((c) => c.id === eventData.calendarId);
        if (cal) {
          calendarRemoteId = cal.remote_id;
          calendarDbId = cal.id;
        }
      }

      // Fallback to primary calendar
      if (!calendarRemoteId) {
        const primary = availableCalendars.find((c) => c.is_primary) ?? availableCalendars[0];
        if (primary) {
          calendarRemoteId = primary.remote_id;
          calendarDbId = primary.id;
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
        attendees: eventData.attendees.map((email) => ({ email })),
      };

      const created = await provider.createEvent(calendarRemoteId, input);

      // Save to local DB
      await upsertCalendarEventFromProvider(activeAccountId, calendarDbId ?? null, created);

      setShowCreate(false);
      setCreateInitialValues(undefined);
      loadEvents();
    } catch (err) {
      console.error("Failed to create event:", err);
      throw err;
    }
  }, [activeAccountId, calendars, loadEvents]);

  const handleEventClick = useCallback((event: DbCalendarEvent, anchor: { x: number; y: number }) => {
    setSelectedEvent(event);
    setEventAnchor(anchor);
  }, []);

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
        onToggleCalendarList={() => setShowCalendarList((v) => !v)}
        showCalendarListButton={calendars.length > 1}
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
            onVisibilityChange={async (calendarId, visible) => {
              const { setCalendarVisibility } = await import("@/services/db/calendars");
              await setCalendarVisibility(calendarId, visible);
              await loadCalendars();
              loadEvents();
            }}
          />
        )}

        <div className="flex-1 min-w-0">
          {view === "month" && (
            <MonthView
              currentDate={currentDate}
              events={events}
              onEventClick={handleEventClick}
            />
          )}
          {view === "week" && (
            <WeekView
              currentDate={currentDate}
              events={events}
              onEventClick={handleEventClick}
            />
          )}
          {view === "day" && (
            <DayView
              currentDate={currentDate}
              events={events}
              onEventClick={handleEventClick}
            />
          )}
        </div>
      </div>

      {showCreate && (
        <EventCreateModal
          calendars={calendars}
          initialValues={createInitialValues}
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
    </div>
  );
}

async function upsertCalendarEventFromProvider(
  accountId: string,
  calendarId: string | null,
  event: CalendarEventData,
): Promise<void> {
  await upsertCalendarEvent({
    accountId,
    googleEventId: event.instanceId ?? event.remoteEventId,
    summary: event.summary,
    description: event.description,
    location: event.location,
    startTime: event.startTime,
    endTime: event.endTime,
    isAllDay: event.isAllDay,
    status: event.status,
    organizerEmail: event.organizerEmail,
    attendeesJson: event.attendeesJson,
    htmlLink: event.htmlLink,
    calendarId,
    remoteEventId: event.remoteEventId,
    etag: event.etag,
    icalData: event.icalData,
    uid: event.uid,
    time: event.time,
    seriesUid: event.seriesUid,
    occurrenceKey: event.occurrenceKey,
    isRecurrenceMaster: event.isRecurrenceMaster,
    transparency: event.transparency,
    sequence: event.sequence,
  });
}
