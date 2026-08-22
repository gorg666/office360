import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountStore } from "@/stores/accountStore";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { calendarMutationService } from "@/services/calendar/calendarMutationService";
import { CalendarPage } from "./CalendarPage";
import type { DateGridDraft } from "./dateGrid";
import type { TimedVisualOverride } from "./timedGrid";

const mocks = vi.hoisted(() => ({
  loadRange: vi.fn(),
  upsertCalendarEvent: vi.fn(),
  getCalendarsForAccount: vi.fn(),
  upsertCalendar: vi.fn(),
  getCalendarProvider: vi.fn(),
  getCapabilities: vi.fn(),
  update: vi.fn(),
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
  calendarMutationService: {
    capabilities: mocks.getCapabilities,
    create: vi.fn(),
    update: mocks.update,
  },
}));
vi.mock("./CalendarToolbar", () => ({
  CalendarToolbar: () => <div>toolbar</div>,
}));
vi.mock("./MonthView", () => ({
  MonthView: ({
    events,
    onDateCommit,
    visualOverrides,
    pendingEventIds,
  }: {
    events: DbCalendarEvent[];
    onDateCommit?: (event: DbCalendarEvent, draft: DateGridDraft, anchor: { x: number; y: number }) => void;
    visualOverrides?: Readonly<Record<string, TimedVisualOverride>>;
    pendingEventIds?: ReadonlySet<string>;
  }) => (
    <div>
      {events.map((item) => (
        <div key={item.id}>
          <button
            type="button"
            data-testid={`date-commit-${item.id}`}
            onClick={() => onDateCommit?.(item, { type: "shift", deltaDays: 2 }, { x: 8, y: 8 })}
          >
            date-commit
          </button>
          <button
            type="button"
            data-testid={`to-allday-${item.id}`}
            onClick={() => onDateCommit?.(item, { type: "to-all-day", startDate: "2027-01-18" }, { x: 8, y: 8 })}
          >
            to-all-day
          </button>
          <button
            type="button"
            data-testid={`to-timed-${item.id}`}
            onClick={() => onDateCommit?.(item, {
              type: "to-timed",
              startDate: "2027-01-15",
              startMinutesFromMidnight: 9 * 60,
            }, { x: 8, y: 8 })}
          >
            to-timed
          </button>
          {visualOverrides?.[item.id]
            ? <span data-testid={`override-${item.id}`}>{visualOverrides[item.id]!.start_time}</span>
            : <span data-testid={`no-override-${item.id}`} />}
          {pendingEventIds?.has(item.id) ? <span data-testid={`pending-${item.id}`} /> : null}
        </div>
      ))}
    </div>
  ),
}));
vi.mock("./WeekView", () => ({ WeekView: () => <div>week</div> }));
vi.mock("./DayView", () => ({ DayView: () => <div>day</div> }));
vi.mock("./EventCreateModal", () => ({ EventCreateModal: () => null }));
vi.mock("./EventDetailModal", () => ({
  EventDetailModal: ({ event }: { event: DbCalendarEvent }) => (
    <div data-testid="event-details">{event.summary}</div>
  ),
}));
vi.mock("./CalendarList", () => ({ CalendarList: () => null }));
vi.mock("./CalendarReauthBanner", () => ({ CalendarReauthBanner: () => null }));

const dbCalendar = {
  id: "cal-1", account_id: "account-1", provider: "caldav", remote_id: "remote-cal-1",
  display_name: "Рабочий", color: "#4285f4", is_primary: 1, is_visible: 1,
  sync_token: null, ctag: null, created_at: 1, updated_at: 1,
};

const fullCapabilities = {
  events: { create: "remote", update: "remote", delete: "remote" },
  recurrence: { updateScopes: ["single", "series"], deleteScopes: ["single", "series"] },
};

function makeDbEvent(overrides: Partial<DbCalendarEvent> = {}): DbCalendarEvent {
  return {
    id: "event-1", account_id: "account-1", google_event_id: "remote-1",
    summary: "Standup", description: null, location: null, start_time: 1_800_000_000,
    end_time: 1_800_003_600, is_all_day: 0, status: "confirmed", organizer_email: null,
    attendees_json: null, html_link: null, updated_at: 1, calendar_id: "cal-1",
    remote_event_id: "remote-1", etag: '"v1"', ical_data: null, uid: "plain-1",
    time_kind: "timed-zoned", tzid: "UTC", wall_start: "2027-01-15T10:00:00",
    wall_end: "2027-01-15T11:00:00", end_date_exclusive: null, series_uid: null,
    occurrence_key: null, is_recurrence_master: 0, transp: null, sequence: 0,
    origin: "remote", projection_key: null, projection_status: null, ...overrides,
  };
}

const occurrence = makeDbEvent({
  id: "event-occ",
  summary: "Weekly",
  uid: "series-1",
  series_uid: "series-1",
  occurrence_key: "series-1::20270115T100000Z",
  google_event_id: "/cal/series.ics",
  remote_event_id: "/cal/series.ics",
});

function loadResult(events: DbCalendarEvent[]) {
  return {
    status: "fresh" as const,
    events,
    calendars: [dbCalendar],
    coverage: "complete" as const,
    hasUsableCache: true,
    hasCalendar: true,
    diagnostics: { unreadableComponentCount: 0, unreadableObjectCount: 0 },
    errorCategory: null,
  };
}

const updateMock = calendarMutationService.update as unknown as ReturnType<typeof vi.fn>;

async function openMonth(id = "event-1") {
  render(<CalendarPage />);
  expect(await screen.findByTestId(`date-commit-${id}`)).toBeInTheDocument();
  await waitFor(() => expect(mocks.getCapabilities).toHaveBeenCalled());
}

describe("CalendarPage date-grid mutations", () => {
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
    mocks.getCapabilities.mockResolvedValue(fullCapabilities);
    mocks.loadRange.mockResolvedValue(loadResult([makeDbEvent()]));
    updateMock.mockResolvedValue({ status: "success", value: {} });
  });

  it("commits a Month date move once through CalendarMutationService", async () => {
    await openMonth();
    fireEvent.click(screen.getByTestId("date-commit-event-1"));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0]![1]).toMatchObject({ isAllDay: false });
    await waitFor(() => expect(screen.getByTestId("no-override-event-1")).toBeInTheDocument());
  });

  it("commits timed → all-day and all-day → timed conversions", async () => {
    await openMonth();
    fireEvent.click(screen.getByTestId("to-allday-event-1"));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0]![1]).toMatchObject({ isAllDay: true });

    mocks.loadRange.mockResolvedValue(loadResult([makeDbEvent({
      is_all_day: 1,
      time_kind: "all-day",
      end_date_exclusive: "2027-01-16",
    })]));
    fireEvent.click(screen.getByTestId("to-timed-event-1"));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(2));
    expect(updateMock.mock.calls[1]![1]).toMatchObject({ isAllDay: false });
  });

  it("rolls back Month conversion failures and shows the CAL-113 error copy", async () => {
    updateMock
      .mockResolvedValueOnce({ status: "network-error", message: "timeout" })
      .mockResolvedValueOnce({ status: "conflict", message: "etag" })
      .mockResolvedValueOnce({ status: "permission-denied", message: "acl" });
    await openMonth();

    fireEvent.click(screen.getByTestId("date-commit-event-1"));
    expect(await screen.findByTestId("timed-mutation-error"))
      .toHaveTextContent("Не удалось связаться с сервером календаря. Повторите попытку.");
    expect(screen.getByTestId("no-override-event-1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("to-allday-event-1"));
    expect(await screen.findByTestId("timed-mutation-error"))
      .toHaveTextContent("Событие было изменено в другом месте. Обновите календарь и попробуйте снова.");
    expect(screen.getByTestId("no-override-event-1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("to-timed-event-1"));
    expect(await screen.findByTestId("timed-mutation-error"))
      .toHaveTextContent("Недостаточно прав для изменения этого календаря.");
    expect(screen.getByTestId("no-override-event-1")).toBeInTheDocument();
  });

  it("asks for recurrence scope on a Month occurrence drag, then rolls back on cancel", async () => {
    mocks.loadRange.mockResolvedValue(loadResult([occurrence]));
    await openMonth("event-occ");
    fireEvent.click(screen.getByTestId("date-commit-event-occ"));

    const dialog = await screen.findByTestId("recurrence-scope-dialog");
    expect(within(dialog).queryByTestId("recurrence-scope-this-and-future")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByTestId("recurrence-scope-single"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0]![0]).toMatchObject({
      recurrenceScope: "single",
      occurrenceKey: "series-1::20270115T100000Z",
      seriesUid: "series-1",
    });

    fireEvent.click(await screen.findByTestId("to-allday-event-occ"));
    fireEvent.click(within(await screen.findByTestId("recurrence-scope-dialog")).getByTestId("recurrence-scope-series"));
    fireEvent.click(within(screen.getByTestId("recurrence-scope-dialog")).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(2));
    expect(updateMock.mock.calls[1]![0]).toMatchObject({ recurrenceScope: "series", seriesUid: "series-1" });

    fireEvent.click(await screen.findByTestId("date-commit-event-occ"));
    fireEvent.click(within(await screen.findByTestId("recurrence-scope-dialog")).getByRole("button", { name: "Отмена" }));
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("recurrence-scope-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("no-override-event-occ")).toBeInTheDocument();
  });
});
