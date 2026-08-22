import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountStore } from "@/stores/accountStore";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { CalendarPage } from "./CalendarPage";

const mocks = vi.hoisted(() => ({
  loadRange: vi.fn(),
  upsertCalendarEvent: vi.fn(),
  getCalendarsForAccount: vi.fn(),
  upsertCalendar: vi.fn(),
  getCalendarProvider: vi.fn(),
  getCapabilities: vi.fn(),
}));

vi.mock("@/services/db/calendarEvents", () => ({
  calendarEventDataToUpsert: vi.fn(() => ({})),
  upsertCalendarEvent: mocks.upsertCalendarEvent,
}));
vi.mock("@/services/db/calendars", () => ({
  getCalendarsForAccount: mocks.getCalendarsForAccount,
  upsertCalendar: mocks.upsertCalendar,
}));
vi.mock("@/services/calendar/providerFactory", () => ({ getCalendarProvider: mocks.getCalendarProvider }));
vi.mock("@/services/calendar/calendarSyncService", () => ({
  calendarSyncService: { loadRange: mocks.loadRange },
}));
vi.mock("@/services/calendar/calendarMutationService", () => ({
  calendarMutationService: { capabilities: mocks.getCapabilities, create: vi.fn() },
}));
vi.mock("./CalendarToolbar", () => ({
  CalendarToolbar: ({ onViewChange, canCreateEvent }: { onViewChange: (view: "week") => void; canCreateEvent?: boolean }) => (
    <div data-testid="calendar-toolbar">
      <button onClick={() => onViewChange("week")}>Week test</button>
      <button disabled={!canCreateEvent}>Create test</button>
    </div>
  ),
}));

vi.mock("./MonthView", () => ({
  MonthView: ({ events }: { events: DbCalendarEvent[] }) => <div data-testid="calendar-events">{events.map((event) => event.summary).join(", ")}</div>,
}));
vi.mock("./WeekView", () => ({
  WeekView: ({ events }: { events: DbCalendarEvent[] }) => <div data-testid="calendar-events">{events.map((event) => event.summary).join(", ")}</div>,
}));
vi.mock("./DayView", () => ({
  DayView: ({ events }: { events: DbCalendarEvent[] }) => <div data-testid="calendar-events">{events.map((event) => event.summary).join(", ")}</div>,
}));
vi.mock("./EventCreateModal", () => ({ EventCreateModal: () => null }));
vi.mock("./EventDetailModal", () => ({ EventDetailModal: () => null }));
vi.mock("./CalendarList", () => ({ CalendarList: () => null }));
vi.mock("./CalendarReauthBanner", () => ({ CalendarReauthBanner: () => <div>Требуется авторизация</div> }));

const dbCalendar = {
  id: "cal-1", account_id: "account-1", provider: "caldav", remote_id: "remote-cal-1",
  display_name: "Рабочий", color: "#4285f4", is_primary: 1, is_visible: 1,
  sync_token: null, ctag: null, created_at: 1, updated_at: 1,
};

function makeDbEvent(summary: string): DbCalendarEvent {
  return {
    id: `event-${summary}`, account_id: "account-1", google_event_id: `remote-${summary}`,
    summary, description: null, location: null, start_time: 1_800_000_000,
    end_time: 1_800_003_600, is_all_day: 0, status: "confirmed", organizer_email: null,
    attendees_json: null, html_link: null, updated_at: 1, calendar_id: "cal-1",
    remote_event_id: `remote-${summary}`, etag: null, ical_data: null, uid: null,
    time_kind: "timed-zoned", tzid: "UTC", wall_start: "2027-01-15T08:00:00",
    wall_end: "2027-01-15T09:00:00", end_date_exclusive: null, series_uid: null,
    occurrence_key: null, is_recurrence_master: 0, transp: null, sequence: 0,
    origin: "remote", projection_key: null, projection_status: null,
  };
}

function loadResult(
  status: "fresh" | "fresh-with-warnings" | "stale" | "error",
  events: DbCalendarEvent[],
  unreadableComponentCount = 0,
) {
  return {
    status, events, calendars: [dbCalendar],
    coverage: events.length > 0 ? "complete" as const : "never-synced" as const,
    hasUsableCache: events.length > 0, hasCalendar: true,
    diagnostics: { unreadableComponentCount, unreadableObjectCount: 0 },
    errorCategory: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("CalendarPage load states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    useAccountStore.setState({
      activeAccountId: "account-1",
      accounts: [{
        id: "account-1", email: "calendar@example.test", displayName: "Calendar",
        avatarUrl: null, isActive: true, provider: "caldav",
      }],
    });
    mocks.getCalendarsForAccount.mockResolvedValue([dbCalendar]);
    mocks.upsertCalendarEvent.mockResolvedValue(undefined);
    mocks.upsertCalendar.mockResolvedValue("cal-1");
    mocks.getCapabilities.mockResolvedValue({
      events: { create: "remote", update: "remote", delete: "remote" },
    });
    mocks.loadRange.mockResolvedValue(loadResult("fresh", [makeDbEvent("Свежее событие")]));
  });

  it("A: remote success replaces cache and clears error notices", async () => {
    render(<CalendarPage />);
    expect(await screen.findByText("Свежее событие")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Create test" })).toBeEnabled());
    expect(screen.queryByText("Не удалось обновить календарь")).not.toBeInTheDocument();
    expect(screen.queryByText("Не удалось загрузить календарь")).not.toBeInTheDocument();
  });

  it("uses provider capabilities to gate event creation", async () => {
    mocks.getCapabilities.mockResolvedValueOnce({
      events: { create: "unsupported", update: "remote", delete: "remote" },
    });
    render(<CalendarPage />);
    expect(await screen.findByRole("button", { name: "Create test" })).toBeDisabled();
  });

  it("B: provider failure keeps cached events visible and marks them stale", async () => {
    mocks.loadRange.mockResolvedValue(loadResult("stale", [makeDbEvent("Событие из кэша")]));
    render(<CalendarPage />);
    expect(await screen.findByText("Не удалось обновить календарь")).toBeInTheDocument();
    expect(screen.getByText("Показаны ранее загруженные данные.")).toBeInTheDocument();
    expect(screen.getByText("Событие из кэша")).toBeInTheDocument();
  });

  it("C: provider failure without usable cache renders an explicit safe error", async () => {
    mocks.loadRange.mockResolvedValue(loadResult("error", []));
    render(<CalendarPage />);
    expect(await screen.findByText("Не удалось загрузить календарь")).toBeInTheDocument();
    expect(screen.getByText("События недоступны. Проверьте подключение и повторите попытку.")).toBeInTheDocument();
  });

  it("D: retry after stale returns the page to fresh data", async () => {
    mocks.loadRange
      .mockResolvedValueOnce(loadResult("stale", [makeDbEvent("Событие из кэша")]))
      .mockResolvedValueOnce(loadResult("fresh", [makeDbEvent("Свежее событие")]));
    render(<CalendarPage />);
    expect(await screen.findByText("Не удалось обновить календарь")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(screen.queryByText("Не удалось обновить календарь")).not.toBeInTheDocument());
    expect(screen.getByText("Свежее событие")).toBeInTheDocument();
    expect(mocks.loadRange).toHaveBeenCalledTimes(2);
  });

  it("E: partial parse stays fresh and shows a degraded notice", async () => {
    mocks.loadRange.mockResolvedValue(loadResult("fresh-with-warnings", [makeDbEvent("Свежее событие")], 1));
    render(<CalendarPage />);
    expect(await screen.findByText("Календарь загружен, но часть событий не удалось прочитать")).toBeInTheDocument();
    expect(screen.getByText("Свежее событие")).toBeInTheDocument();
  });

  it("F: an older range response cannot overwrite a newer view", async () => {
    const first = deferred<ReturnType<typeof loadResult>>();
    const second = deferred<ReturnType<typeof loadResult>>();
    mocks.loadRange.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<CalendarPage />);
    fireEvent.click(screen.getByRole("button", { name: "Week test" }));
    await act(async () => second.resolve(loadResult("fresh", [makeDbEvent("Новый диапазон")])));
    expect(screen.getByText("Новый диапазон")).toBeInTheDocument();
    await act(async () => first.resolve(loadResult("fresh", [makeDbEvent("Старый диапазон")])));
    expect(screen.queryByText("Старый диапазон")).not.toBeInTheDocument();
  });

  it("G: an old account response cannot overwrite the active account", async () => {
    const first = deferred<ReturnType<typeof loadResult>>();
    const second = deferred<ReturnType<typeof loadResult>>();
    mocks.loadRange.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<CalendarPage />);
    act(() => useAccountStore.setState({
      activeAccountId: "account-2",
      accounts: [{
        id: "account-2", email: "second@example.test", displayName: "Second",
        avatarUrl: null, isActive: true, provider: "caldav",
      }],
    }));
    await act(async () => second.resolve(loadResult("fresh", [makeDbEvent("Аккаунт B")])));
    expect(screen.getByText("Аккаунт B")).toBeInTheDocument();
    await act(async () => first.resolve(loadResult("fresh", [makeDbEvent("Аккаунт A")])));
    expect(screen.queryByText("Аккаунт A")).not.toBeInTheDocument();
  });
});
