import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountStore } from "@/stores/accountStore";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { CalendarPage } from "./CalendarPage";

const mocks = vi.hoisted(() => ({
  deleteCalendarEventsInRange: vi.fn(),
  getCalendarEventsInRangeMulti: vi.fn(),
  upsertCalendarEvent: vi.fn(),
  getVisibleCalendars: vi.fn(),
  getCalendarsForAccount: vi.fn(),
  upsertCalendar: vi.fn(),
  getCalendarProvider: vi.fn(),
  hasCalendarSupport: vi.fn(),
  listCalendars: vi.fn(),
  fetchEvents: vi.fn(),
}));

vi.mock("@/services/db/calendarEvents", () => ({
  deleteCalendarEventsInRange: mocks.deleteCalendarEventsInRange,
  getCalendarEventsInRangeMulti: mocks.getCalendarEventsInRangeMulti,
  upsertCalendarEvent: mocks.upsertCalendarEvent,
}));

vi.mock("@/services/db/calendars", () => ({
  getVisibleCalendars: mocks.getVisibleCalendars,
  getCalendarsForAccount: mocks.getCalendarsForAccount,
  upsertCalendar: mocks.upsertCalendar,
}));

vi.mock("@/services/calendar/providerFactory", () => ({
  getCalendarProvider: mocks.getCalendarProvider,
  hasCalendarSupport: mocks.hasCalendarSupport,
}));

vi.mock("./CalendarToolbar", () => ({
  CalendarToolbar: () => <div data-testid="calendar-toolbar" />,
}));

vi.mock("./MonthView", () => ({
  MonthView: ({ events }: { events: DbCalendarEvent[] }) => (
    <div data-testid="calendar-events">{events.map((event) => event.summary).join(", ")}</div>
  ),
}));

vi.mock("./WeekView", () => ({ WeekView: () => null }));
vi.mock("./DayView", () => ({ DayView: () => null }));
vi.mock("./EventCreateModal", () => ({ EventCreateModal: () => null }));
vi.mock("./EventDetailModal", () => ({ EventDetailModal: () => null }));
vi.mock("./CalendarList", () => ({ CalendarList: () => null }));
vi.mock("./CalendarReauthBanner", () => ({ CalendarReauthBanner: () => <div>Требуется авторизация</div> }));

const dbCalendar = {
  id: "cal-1",
  account_id: "account-1",
  provider: "caldav",
  remote_id: "remote-cal-1",
  display_name: "Рабочий",
  color: "#4285f4",
  is_primary: 1,
  is_visible: 1,
  sync_token: null,
  ctag: null,
  created_at: 1,
  updated_at: 1,
};

function makeDbEvent(summary: string): DbCalendarEvent {
  return {
    id: `event-${summary}`,
    account_id: "account-1",
    google_event_id: `remote-${summary}`,
    summary,
    description: null,
    location: null,
    start_time: 1_800_000_000,
    end_time: 1_800_003_600,
    is_all_day: 0,
    status: "confirmed",
    organizer_email: null,
    attendees_json: null,
    html_link: null,
    updated_at: 1,
    calendar_id: "cal-1",
    remote_event_id: `remote-${summary}`,
    etag: null,
    ical_data: null,
    uid: null,
  };
}

const providerEvent = {
  remoteEventId: "remote-fresh",
  summary: "Свежее событие",
  description: null,
  location: null,
  startTime: 1_800_000_000,
  endTime: 1_800_003_600,
  isAllDay: false,
  status: "confirmed",
  organizerEmail: null,
  attendeesJson: null,
  htmlLink: null,
};

describe("CalendarPage load states", () => {
  const provider = {
    type: "caldav",
    listCalendars: mocks.listCalendars,
    fetchEvents: mocks.fetchEvents,
    lastReadDiagnostics: { unreadableComponentCount: 0, unreadableObjectCount: 0 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    useAccountStore.setState({
      activeAccountId: "account-1",
      accounts: [{
        id: "account-1",
        email: "calendar@example.test",
        displayName: "Calendar",
        avatarUrl: null,
        isActive: true,
        provider: "caldav",
      }],
    });

    provider.type = "caldav";
    provider.lastReadDiagnostics = { unreadableComponentCount: 0, unreadableObjectCount: 0 };
    mocks.hasCalendarSupport.mockResolvedValue(true);
    mocks.getCalendarProvider.mockResolvedValue(provider);
    mocks.getVisibleCalendars.mockResolvedValue([dbCalendar]);
    mocks.getCalendarsForAccount.mockResolvedValue([dbCalendar]);
    mocks.listCalendars.mockResolvedValue([]);
    mocks.fetchEvents.mockResolvedValue([providerEvent]);
    mocks.deleteCalendarEventsInRange.mockResolvedValue(undefined);
    mocks.upsertCalendarEvent.mockResolvedValue(undefined);
    mocks.upsertCalendar.mockResolvedValue("cal-1");
  });

  it("A: Google remote success replaces cache and clears error notices", async () => {
    provider.type = "google_api";
    mocks.getCalendarEventsInRangeMulti
      .mockResolvedValueOnce([makeDbEvent("Кэшированное событие")])
      .mockResolvedValueOnce([makeDbEvent("Свежее событие")]);

    render(<CalendarPage />);

    expect(await screen.findByText("Свежее событие")).toBeInTheDocument();
    expect(screen.queryByText("Не удалось обновить календарь")).not.toBeInTheDocument();
    expect(screen.queryByText("Не удалось загрузить календарь")).not.toBeInTheDocument();
  });

  it("B: CalDAV failure keeps cached events visible and marks them stale", async () => {
    mocks.getCalendarEventsInRangeMulti.mockResolvedValue([makeDbEvent("Событие из кэша")]);
    mocks.listCalendars.mockRejectedValue(new Error("provider unavailable"));

    render(<CalendarPage />);

    expect(await screen.findByText("Не удалось обновить календарь")).toBeInTheDocument();
    expect(screen.getByText("Показаны ранее загруженные данные.")).toBeInTheDocument();
    expect(screen.getByText("Событие из кэша")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
  });

  it("C: Google failure without usable cache renders an explicit safe error", async () => {
    provider.type = "google_api";
    mocks.getCalendarEventsInRangeMulti.mockResolvedValue([]);
    mocks.listCalendars.mockRejectedValue(new Error("offline: token=secret-value"));

    render(<CalendarPage />);

    expect(await screen.findByText("Не удалось загрузить календарь")).toBeInTheDocument();
    expect(screen.getByText("События недоступны. Проверьте подключение и повторите попытку.")).toBeInTheDocument();
    expect(screen.queryByText(/secret-value/)).not.toBeInTheDocument();
  });

  it("D: retry after a CalDAV stale response returns the page to fresh data", async () => {
    mocks.getCalendarEventsInRangeMulti
      .mockResolvedValueOnce([makeDbEvent("Событие из кэша")])
      .mockResolvedValueOnce([makeDbEvent("Событие из кэша")])
      .mockResolvedValueOnce([makeDbEvent("Свежее событие")]);
    mocks.listCalendars
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce([]);

    render(<CalendarPage />);

    expect(await screen.findByText("Не удалось обновить календарь")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));

    await waitFor(() => {
      expect(screen.queryByText("Не удалось обновить календарь")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Свежее событие")).toBeInTheDocument();
    expect(mocks.listCalendars).toHaveBeenCalledTimes(2);
  });

  it("E: partial parse stays fresh, preserves cache, and shows a degraded notice", async () => {
    provider.lastReadDiagnostics = { unreadableComponentCount: 1, unreadableObjectCount: 0 };
    mocks.getCalendarEventsInRangeMulti
      .mockResolvedValueOnce([makeDbEvent("Событие из кэша")])
      .mockResolvedValueOnce([makeDbEvent("Свежее событие")]);

    render(<CalendarPage />);

    expect(await screen.findByText("Календарь загружен, но часть событий не удалось прочитать")).toBeInTheDocument();
    expect(screen.getByText("Свежее событие")).toBeInTheDocument();
    expect(screen.queryByText("Не удалось обновить календарь")).not.toBeInTheDocument();
    expect(mocks.deleteCalendarEventsInRange).not.toHaveBeenCalled();
  });
});
