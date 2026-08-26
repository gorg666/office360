/*
 * Calendar visual smoke — dev-only, DESIGN-001C.
 *
 * Renders the real Month/Week/Day views and toolbar against fixture events, so
 * the grid hierarchy, per-calendar colours, current-time indicator and overflow
 * chip can be reviewed without a Tauri/SQLite backend. The browser preview of
 * the full app cannot load calendar data, so this is the only way to see the
 * grid before packaging a desktop build.
 *
 * Not in any production bundle — see design-lab/README.md.
 *
 *   npm run dev  ->  /design-lab/calendar.html
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import "@/styles/globals.css";

import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { DayView } from "@/components/calendar/DayView";
import { CalendarToolbar, type CalendarView } from "@/components/calendar/CalendarToolbar";
import { EventCreateModal } from "@/components/calendar/EventCreateModal";
import { EventDetailModal } from "@/components/calendar/EventDetailModal";
import { PeoplePicker } from "@/components/people/PeoplePicker";
import type { DbCalendar } from "@/services/db/calendars";
import { CalendarColorProvider } from "@/components/calendar/calendarColorContext";
import { Toggle } from "@/components/ui/Toggle";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";

const TZ = "Europe/Moscow";

const CALENDARS = [
  { id: "cal-work", color: "#5d55d8" },
  { id: "cal-personal", color: "#079455" },
  { id: "cal-travel", color: "#dc6803" },
  { id: "cal-oncall", color: "#d92d20" },
  { id: "cal-nocolour", color: null },
];

/** Enough of a DbCalendar for the modals to render; not a domain fixture. */
const DB_CALENDARS = CALENDARS.map((c, i) => ({
  id: c.id,
  account_id: "acc",
  provider: "caldav",
  remote_id: c.id,
  display_name: ["Работа", "Личное", "Поездки", "Дежурства", "Без цвета"][i],
  color: c.color,
  is_primary: i === 0 ? 1 : 0,
  is_visible: 1,
  sync_token: null,
  ctag: null,
  created_at: 0,
  updated_at: 0,
  access_json: null,
  access_observed_at: null,
  provider_presence: "present",
  provider_seen_at: null,
})) as unknown as DbCalendar[];

/** Local directory stub — the picker never reaches the network here. */
const PEOPLE = [
  { name: "Анна Ковалёва", email: "anna@example.com", jobTitle: "Продуктовый дизайнер", department: "Дизайн" },
  { name: "Борис Титов", email: "boris@example.com", jobTitle: "Backend-инженер", department: "Платформа" },
  { name: "Вера Смирнова", email: "vera@example.com", jobTitle: "QA-инженер", department: "Качество" },
  { name: "Григорий Орлов", email: "grigory@example.com", jobTitle: null, department: null },
];

const searchPeople = async (input: { query: string }) => ({
  people: PEOPLE.filter((p) =>
    `${p.name} ${p.email}`.toLowerCase().includes(input.query.toLowerCase()),
  ).map((p) => ({
    displayName: p.name,
    email: p.email,
    normalizedEmail: p.email.toLowerCase(),
    jobTitle: p.jobTitle,
    department: p.department,
    avatarUrl: null,
    source: "directory" as const,
  })),
  directorySearch: "ok" as const,
});

let seq = 0;

function makeEvent(
  calendarId: string,
  summary: string,
  dayOffset: number,
  startHour: number,
  durationHours: number,
  allDay = false,
): DbCalendarEvent {
  const day = new Date();
  day.setDate(day.getDate() + dayOffset);
  day.setHours(startHour, 0, 0, 0);
  const start = Math.floor(day.getTime() / 1000);
  seq += 1;
  return {
    id: `evt-${seq}`,
    account_id: "acc",
    google_event_id: `g-${seq}`,
    summary,
    description: null,
    location: null,
    start_time: start,
    end_time: start + durationHours * 3600,
    is_all_day: allDay ? 1 : 0,
    status: "confirmed",
    organizer_email: null,
    attendees_json: null,
    html_link: null,
    updated_at: start,
    calendar_id: calendarId,
    remote_event_id: null,
    etag: null,
    ical_data: null,
    uid: null,
    time_kind: allDay ? "all-day" : "timed-zoned",
    tzid: TZ,
    wall_start: null,
    wall_end: null,
    end_date_exclusive: null,
    series_uid: null,
    occurrence_key: null,
    is_recurrence_master: 0,
    transp: "opaque",
  } as DbCalendarEvent;
}

const EVENTS: DbCalendarEvent[] = [
  makeEvent("cal-work", "Планёрка команды", 0, 9, 1),
  makeEvent("cal-work", "1:1 с Анной", 0, 11, 1),
  makeEvent("cal-personal", "Спортзал", 0, 19, 1),
  makeEvent("cal-oncall", "Дежурство", 0, 0, 24, true),
  makeEvent("cal-work", "Ретро спринта", 1, 14, 2),
  makeEvent("cal-travel", "Рейс SVO → LED", 1, 7, 2),
  makeEvent("cal-nocolour", "Без цвета календаря", 1, 16, 1),
  makeEvent("cal-personal", "Ужин с семьёй", 2, 20, 2),
  makeEvent("cal-work", "Демо для клиента", 2, 10, 1),
  makeEvent("cal-work", "Код-ревью", 2, 11, 1),
  makeEvent("cal-work", "Синк по релизу", 2, 12, 1),
  makeEvent("cal-personal", "Врач", 2, 13, 1),
  makeEvent("cal-travel", "Отпуск", 3, 0, 24, true),
  makeEvent("cal-work", "Интервью", -1, 15, 1),
  makeEvent("cal-oncall", "Инцидент postmortem", -1, 17, 1),
];

function Harness() {
  const [dark, setDark] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [view, setView] = useState<CalendarView>("week");
  const [surface, setSurface] = useState<"grid" | "create" | "detail" | "picker">("grid");
  const [pickerValue, setPickerValue] = useState<any[]>([]);
  const [currentDate, setCurrentDate] = useState(() => new Date());

  const toggleTheme = (next: boolean) => {
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.style.setProperty(
      "--app-window-gradient",
      next
        ? "linear-gradient(135deg, #0a0a0a 0%, #171717 45%, #262626 100%)"
        : "linear-gradient(135deg, #fafafa 0%, #f5f5f5 35%, #eeeeee 70%, #ffffff 100%)",
    );
  };

  const shift = (days: number) => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + days);
    setCurrentDate(next);
  };

  const noop = () => {};

  return (
    <div className="surface-base flex h-screen flex-col">
      <div className="flex items-center gap-6 border-b border-separator px-4 py-2">
        <span className="text-meta font-semibold text-ink-primary">Calendar visual smoke</span>
        <Toggle checked={dark} onChange={toggleTheme} label="Тёмная тема" />
        <Toggle checked={narrow} onChange={setNarrow} label="Narrow desktop" />
        <div className="flex gap-1">
          {(["grid", "create", "detail", "picker"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSurface(s)}
              className={`focus-ring rounded-control px-2.5 py-1 text-control ${
                surface === s ? "bg-brand text-brand-contrast" : "text-ink-secondary hover:bg-brand-tint-1"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`surface-solid mx-auto flex min-h-0 flex-1 flex-col overflow-hidden ${
          narrow ? "w-[900px] border-x border-separator" : "w-full"
        } ${surface === "picker" ? "hidden" : ""}`}
      >
        <CalendarToolbar
          currentDate={currentDate}
          view={view}
          onPrev={() => shift(view === "month" ? -30 : view === "week" ? -7 : -1)}
          onNext={() => shift(view === "month" ? 30 : view === "week" ? 7 : 1)}
          onToday={() => setCurrentDate(new Date())}
          onViewChange={setView}
          onCreateEvent={noop}
          showCalendarListButton
          onToggleCalendarList={noop}
        />

        <CalendarColorProvider calendars={CALENDARS}>
          <div className="flex min-h-0 flex-1 flex-col">
            {view === "month" && (
              <MonthView
                currentDate={currentDate}
                events={EVENTS}
                displayTimeZone={TZ}
                onEventClick={noop}
                onDateCommit={noop}
              />
            )}
            {view === "week" && (
              <WeekView
                currentDate={currentDate}
                events={EVENTS}
                displayTimeZone={TZ}
                onEventClick={noop}
                onTimedCommit={noop}
                onDateCommit={noop}
              />
            )}
            {view === "day" && (
              <DayView
                currentDate={currentDate}
                events={EVENTS}
                displayTimeZone={TZ}
                onEventClick={noop}
                onTimedCommit={noop}
                onDateCommit={noop}
              />
            )}
          </div>
        </CalendarColorProvider>
      </div>

      {surface === "create" && (
        <EventCreateModal
          calendars={DB_CALENDARS}
          accountId="acc"
          selfEmail="me@example.com"
          selfDisplayName="Я"
          timeZone={TZ}
          onClose={() => setSurface("grid")}
          onCreate={noop}
        />
      )}

      {surface === "detail" && (
        <EventDetailModal
          event={EVENTS[4]!}
          calendars={DB_CALENDARS}
          accountId="acc"
          timeZone={TZ}
          onClose={() => setSurface("grid")}
          onUpdated={noop}
        />
      )}

      {surface === "picker" && (
        <div className="surface-raised mx-auto mt-8 w-[34rem] rounded-panel border border-separator p-5 shadow-e2">
          <h2 className="mb-3 text-section font-semibold text-ink-primary">PeoplePicker</h2>
          <PeoplePicker
            label="Участники"
            selected={pickerValue}
            onChange={setPickerValue}
            search={searchPeople as any}
            debounceMs={0}
          />
          <p className="mt-3 text-caption text-ink-tertiary">
            Введите «а», чтобы увидеть результаты каталога.
          </p>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
