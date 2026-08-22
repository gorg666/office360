import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountStore } from "@/stores/accountStore";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { calendarMutationService } from "@/services/calendar/calendarMutationService";
import { CalendarPage } from "./CalendarPage";
import type { GridCreateDraft } from "./createSelection";
import type { EventCreateInput } from "./EventCreateModal";

const mocks = vi.hoisted(() => ({
  loadRange: vi.fn(),
  upsertCalendarEvent: vi.fn(),
  getCalendarsForAccount: vi.fn(),
  upsertCalendar: vi.fn(),
  getCalendarProvider: vi.fn(),
  getCapabilities: vi.fn(),
  create: vi.fn(),
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
    create: mocks.create,
    update: vi.fn(),
  },
}));
vi.mock("./CalendarToolbar", () => ({
  CalendarToolbar: () => <div>toolbar</div>,
}));
vi.mock("./MonthView", () => ({
  MonthView: ({ onCreateDraft }: { onCreateDraft?: (draft: GridCreateDraft) => void }) => (
    <button
      type="button"
      data-testid="month-create"
      onClick={() => onCreateDraft?.({
        kind: "all-day",
        startDate: "2026-08-27",
        endDateExclusive: "2026-08-28",
      })}
    >
      month-create
    </button>
  ),
}));
vi.mock("./WeekView", () => ({ WeekView: () => <div>week</div> }));
vi.mock("./DayView", () => ({ DayView: () => <div>day</div> }));
vi.mock("./EventCreateModal", () => ({
  EventCreateModal: ({
    initialValues,
    onClose,
  }: {
    initialValues?: Partial<EventCreateInput>;
    onClose: () => void;
  }) => (
    <div data-testid="create-modal">
      <span data-testid="create-start">{initialValues?.startTime}</span>
      <span data-testid="create-end">{initialValues?.endTime}</span>
      <span data-testid="create-all-day">{String(Boolean(initialValues?.allDay))}</span>
      <button type="button" onClick={onClose}>Cancel</button>
    </div>
  ),
}));
vi.mock("./EventDetailModal", () => ({ EventDetailModal: () => null }));
vi.mock("./CalendarList", () => ({ CalendarList: () => null }));
vi.mock("./CalendarReauthBanner", () => ({ CalendarReauthBanner: () => null }));

const dbCalendar = {
  id: "cal-1", account_id: "account-1", provider: "caldav", remote_id: "remote-cal-1",
  display_name: "Рабочий", color: "#4285f4", is_primary: 1, is_visible: 1,
  sync_token: null, ctag: null, created_at: 1, updated_at: 1,
};

function makeDbEvent(): DbCalendarEvent {
  return {
    id: "event-1", account_id: "account-1", google_event_id: "remote-1",
    summary: "Standup", description: null, location: null, start_time: 1_800_000_000,
    end_time: 1_800_003_600, is_all_day: 0, status: "confirmed", organizer_email: null,
    attendees_json: null, html_link: null, updated_at: 1, calendar_id: "cal-1",
    remote_event_id: "remote-1", etag: '"v1"', ical_data: null, uid: "plain-1",
    time_kind: "timed-zoned", tzid: "UTC", wall_start: "2027-01-15T10:00:00",
    wall_end: "2027-01-15T11:00:00", end_date_exclusive: null, series_uid: null,
    occurrence_key: null, is_recurrence_master: 0, transp: null, sequence: 0,
    origin: "remote", projection_key: null, projection_status: null,
  };
}

describe("CalendarPage create by selection", () => {
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
      recurrence: { updateScopes: ["single", "series"], deleteScopes: ["single", "series"] },
    });
    mocks.loadRange.mockResolvedValue({
      status: "fresh",
      events: [makeDbEvent()],
      calendars: [dbCalendar],
      coverage: "complete",
      hasUsableCache: true,
      hasCalendar: true,
      diagnostics: { unreadableComponentCount: 0, unreadableObjectCount: 0 },
      errorCategory: null,
    });
    mocks.create.mockResolvedValue({ status: "success", value: {} });
  });

  it("opens EventCreateModal from a grid draft and Cancel does not mutate", async () => {
    render(<CalendarPage />);
    fireEvent.click(await screen.findByTestId("month-create"));
    expect(await screen.findByTestId("create-modal")).toBeInTheDocument();
    expect(screen.getByTestId("create-start")).toHaveTextContent("2026-08-27");
    expect(screen.getByTestId("create-all-day")).toHaveTextContent("true");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("create-modal")).not.toBeInTheDocument());
    expect(calendarMutationService.create).not.toHaveBeenCalled();
  });

  it("does not open create when the provider cannot create events", async () => {
    mocks.getCapabilities.mockResolvedValue({
      events: { create: "unsupported", update: "remote", delete: "remote" },
      recurrence: { updateScopes: ["single", "series"], deleteScopes: ["single", "series"] },
    });
    render(<CalendarPage />);
    fireEvent.click(await screen.findByTestId("month-create"));
    expect(screen.queryByTestId("create-modal")).not.toBeInTheDocument();
    expect(calendarMutationService.create).not.toHaveBeenCalled();
  });
});
