import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Event as TauriEvent } from "@tauri-apps/api/event";
import type { CefEvent } from "@/services/cef";
import { getCalendarEventsInRange } from "@/services/db/calendarEvents";
import { TelemostPage } from "./TelemostPage";

const accountState = {
  activeAccountId: "acc-1" as string | null,
  accounts: [{ id: "acc-1", email: "user@example.com", displayName: "User", avatarUrl: null, isActive: true }],
};

let cefEventHandler: ((event: TauriEvent<CefEvent>) => void) | null = null;
const cefCreate = vi.fn(async () => undefined);
const cefDomCommand = vi.fn(async () => ({ requestId: "request-1", accepted: true }));
const cefInitialize = vi.fn(async () => undefined);
const cefNavigate = vi.fn(async () => undefined);
const cefSetBounds = vi.fn(async () => undefined);
const cefSetVisible = vi.fn(async () => undefined);

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: (selector: (state: typeof accountState) => unknown) => selector(accountState),
}));
vi.mock("@/services/db/accounts", () => ({
  getAccount: vi.fn(async () => ({ id: "acc-1", oauth_provider: "yandex", auth_method: "oauth2" })),
}));
vi.mock("@/services/db/calendarEvents", () => ({ getCalendarEventsInRange: vi.fn(async () => []) }));
vi.mock("@/services/yandex360/telemost", () => ({ createTelemostConference: vi.fn() }));
vi.mock("@/router/navigate", () => ({ navigateToLabel: vi.fn() }));
vi.mock("@/utils/openComposeWindow", () => ({ openNewCompose: vi.fn() }));
vi.mock("@/services/cef", () => ({
  cefCreate: (...args: unknown[]) => cefCreate(...args),
  cefDomCommand: (...args: unknown[]) => cefDomCommand(...args),
  cefInitialize: (...args: unknown[]) => cefInitialize(...args),
  cefNavigate: (...args: unknown[]) => cefNavigate(...args),
  cefPermissionResponse: vi.fn(),
  cefSetBounds: (...args: unknown[]) => cefSetBounds(...args),
  cefSetVisible: (...args: unknown[]) => cefSetVisible(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_eventName: string, handler: (event: TauriEvent<CefEvent>) => void) => {
    cefEventHandler = handler;
    return () => { cefEventHandler = null; };
  }),
}));

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function emitCef(type: string, payload: Record<string, unknown>) {
  if (!cefEventHandler) throw new Error("CEF event listener is not ready");
  cefEventHandler({ event: "cef-event", id: 1, payload: { type, payload } } as TauriEvent<CefEvent>);
}

describe("TelemostPage Continue handshake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCalendarEventsInRange).mockResolvedValue([]);
    cefEventHandler = null;
    accountState.activeAccountId = "acc-1";
    accountState.accounts = [{ id: "acc-1", email: "user@example.com", displayName: "User", avatarUrl: null, isActive: true }];
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the embedded CEF session with the shared Efim oauth profile", async () => {
    render(<TelemostPage />);
    await waitFor(() => expect(cefCreate).toHaveBeenCalled());
    expect(cefCreate.mock.calls.some((args) => args[1] === "oauth")).toBe(true);
    expect(cefCreate.mock.calls.every((args) => args[1] !== "acc-1")).toBe(true);
  });

  it("renders the matching Continue CTA and resumes through the marked DOM control", async () => {
    render(<TelemostPage />);
    await waitFor(() => expect(cefEventHandler).not.toBeNull());

    act(() => {
      emitCef("navigation", { url: "https://telemost.yandex.ru/j/42" });
      emitCef("telemost-action", {
        action: "continue",
        available: true,
        url: "https://telemost.yandex.ru/j/42",
      });
    });

    const continueButton = await screen.findByRole("button", { name: /Продолжить/i });
    await act(async () => {
      fireEvent.click(continueButton);
    });

    expect(cefDomCommand).toHaveBeenCalledTimes(1);
    expect(cefDomCommand).toHaveBeenCalledWith({
      type: "click",
      selector: '[data-o360-continue="true"]',
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Продолжить/i })).not.toBeInTheDocument());
  });

  it("does not attach a Continue action to a different meeting", async () => {
    render(<TelemostPage />);
    await waitFor(() => expect(cefEventHandler).not.toBeNull());

    act(() => {
      emitCef("navigation", { url: "https://telemost.yandex.ru/j/42" });
      emitCef("telemost-action", {
        action: "continue",
        available: true,
        url: "https://telemost.yandex.ru/j/99",
      });
    });

    expect(screen.queryByRole("button", { name: /Продолжить/i })).not.toBeInTheDocument();
    expect(cefDomCommand).not.toHaveBeenCalled();
  });

  it("renders calendar meetings with the modern participant envelope without crashing", async () => {
    vi.mocked(getCalendarEventsInRange).mockResolvedValue([{
      id: "evt-1",
      account_id: "acc-1",
      google_event_id: "google-1",
      summary: "Telemost sync",
      description: "Join https://telemost.yandex.ru/j/424242",
      location: null,
      html_link: null,
      ical_data: null,
      start_time: 1_700_000_000,
      end_time: 1_700_003_600,
      is_all_day: 0,
      status: "confirmed",
      organizer_email: "host@example.com",
      attendees_json: JSON.stringify({
        version: 1,
        attendees: [{
          participant: { kind: "email", value: "one@example.com", normalizedEmail: "one@example.com", displayName: "One" },
          role: "required",
          status: "accepted",
          rsvpRequested: false,
          participantType: "individual",
          delegatedTo: [],
          delegatedFrom: [],
        }],
      }),
      updated_at: 1_700_000_000,
      calendar_id: null,
      remote_event_id: null,
      etag: null,
      uid: null,
      time_kind: "timed-zoned",
      tzid: null,
      wall_start: null,
      wall_end: null,
      end_date_exclusive: null,
      series_uid: null,
      occurrence_key: null,
      is_recurrence_master: 0,
      transp: null,
      sequence: 0,
      origin: null,
      projection_key: null,
      projection_status: null,
      reminders_json: null,
    }]);

    render(<TelemostPage />);
    expect(await screen.findByText("Telemost sync")).toBeInTheDocument();
    expect(await screen.findByText(/Участники \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("One")).toBeInTheDocument();
  });

  it("keeps legacy attendee arrays compatible through the calendar decoder", async () => {
    vi.mocked(getCalendarEventsInRange).mockResolvedValue([{
      id: "evt-legacy",
      account_id: "acc-1",
      google_event_id: "google-legacy",
      summary: "Legacy sync",
      description: "https://telemost.yandex.ru/j/999001",
      location: null,
      html_link: null,
      ical_data: null,
      start_time: 1_700_000_000,
      end_time: 1_700_003_600,
      is_all_day: 0,
      status: "confirmed",
      organizer_email: "host@example.com",
      attendees_json: JSON.stringify([
        { email: "legacy@example.com", displayName: "Legacy", responseStatus: "accepted" },
      ]),
      updated_at: 1_700_000_000,
      calendar_id: null,
      remote_event_id: null,
      etag: null,
      uid: null,
      time_kind: "timed-zoned",
      tzid: null,
      wall_start: null,
      wall_end: null,
      end_date_exclusive: null,
      series_uid: null,
      occurrence_key: null,
      is_recurrence_master: 0,
      transp: null,
      sequence: 0,
      origin: null,
      projection_key: null,
      projection_status: null,
      reminders_json: null,
    }]);

    render(<TelemostPage />);
    expect(await screen.findByText("Legacy sync")).toBeInTheDocument();
    expect(await screen.findByText(/Участники \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("Legacy")).toBeInTheDocument();
  });
});
