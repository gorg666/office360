import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { useAccountStore } from "@/stores/accountStore";
import { calendarOrganizerFromInput, dedupeCalendarAttendees, googleCalendarAccess, serializeCalendarAccess, serializeCalendarParticipants } from "@/services/calendar/domain";
import { EventDetailModal } from "./EventDetailModal";

const mocks = vi.hoisted(() => ({ capabilities: vi.fn() }));

vi.mock("@/services/calendar/calendarMutationService", () => ({
  calendarMutationService: {
    capabilities: mocks.capabilities,
    update: vi.fn(),
    delete: vi.fn(),
    respond: vi.fn(),
  },
}));

const calendar = {
  id: "cal-1", account_id: "account-1", provider: "caldav", remote_id: "/cal/",
  display_name: "Рабочий", color: "#4285f4", is_primary: 1, is_visible: 1,
  sync_token: null, ctag: null, created_at: 1, updated_at: 1,
  access_json: serializeCalendarAccess(googleCalendarAccess("owner")), access_observed_at: 1,
  provider_presence: "present" as const, provider_seen_at: 1,
};

function event(overrides: Partial<DbCalendarEvent> = {}): DbCalendarEvent {
  return {
    id: "event-1", account_id: "account-1", google_event_id: "/cal/series.ics",
    summary: "Weekly", description: null, location: null,
    start_time: 1_800_000_000, end_time: 1_800_003_600, is_all_day: 0,
    status: "confirmed", organizer_email: null, attendees_json: null, html_link: null,
    updated_at: 1, calendar_id: "cal-1", remote_event_id: "/cal/series.ics",
    etag: '"v1"', ical_data: null, uid: "series-1", time_kind: "timed-zoned",
    tzid: "UTC", wall_start: "2027-01-15T08:00:00", wall_end: "2027-01-15T09:00:00",
    end_date_exclusive: null, series_uid: "series-1", occurrence_key: null,
    is_recurrence_master: 0, transp: null, sequence: 3, origin: "remote",
    projection_key: null, projection_status: null, ...overrides,
  };
}

const seriesOnlyCapabilities = {
  events: { create: "remote", update: "remote", delete: "remote" },
  recurrence: { updateScopes: ["series"], deleteScopes: ["series"] },
  rsvp: { remote: "direct" },
};

describe("EventDetailModal provider capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.setState({
      activeAccountId: "account-1",
      accounts: [{ id: "account-1", email: "self@example.com", displayName: "Self", avatarUrl: null, isActive: true, provider: "caldav" }],
    });
    mocks.capabilities.mockResolvedValue(seriesOnlyCapabilities);
  });

  it("shows occurrence update/delete when a series-only provider still allows series mutation", async () => {
    render(<EventDetailModal
      event={event({ occurrence_key: "series-1::20270115T080000Z" })}
      calendars={[calendar]}
      accountId="account-1"
      onClose={vi.fn()}
      onUpdated={vi.fn()}
    />);

    expect(await screen.findByRole("button", { name: "Изменить" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Удалить" })).toBeInTheDocument();
  });

  it("shows series update/delete when that scope is declared", async () => {
    render(<EventDetailModal
      event={event({ is_recurrence_master: 1 })}
      calendars={[calendar]}
      accountId="account-1"
      onClose={vi.fn()}
      onUpdated={vi.fn()}
    />);

    expect(await screen.findByRole("button", { name: "Изменить" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Удалить" })).toBeInTheDocument();
  });
});

const canonicalEnvelope = serializeCalendarParticipants({
  organizer: calendarOrganizerFromInput({ email: "owner@example.com", displayName: "Владелец календаря" }),
  attendees: dedupeCalendarAttendees([
    { email: "req@example.com", displayName: "Обязательный", responseStatus: "accepted" },
    { email: "opt@example.com", displayName: "Необязательный", optional: true, responseStatus: "tentative" },
    { email: "self@example.com", displayName: "Я", responseStatus: "declined" },
  ]),
});

describe("EventDetailModal participant rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.setState({
      activeAccountId: "account-1",
      accounts: [{ id: "account-1", email: "self@example.com", displayName: "Self", avatarUrl: null, isActive: true, provider: "caldav" }],
    });
    mocks.capabilities.mockResolvedValue(seriesOnlyCapabilities);
  });

  it("renders the canonical organizer and attendee roles", async () => {
    render(<EventDetailModal
      event={event({ attendees_json: canonicalEnvelope, organizer_email: "owner@example.com" })}
      calendars={[calendar]} accountId="account-1" onClose={vi.fn()} onUpdated={vi.fn()}
    />);

    expect(await screen.findByText("Владелец календаря")).toBeInTheDocument();
    expect(screen.getByText("Обязательный")).toBeInTheDocument();
    expect(screen.getByText("Необязательный")).toBeInTheDocument();
    expect(screen.getByText("(необязательно)")).toBeInTheDocument();
  });

  it("resolves the current account attendee and preselects its response", async () => {
    render(<EventDetailModal
      event={event({ attendees_json: canonicalEnvelope, organizer_email: "owner@example.com" })}
      calendars={[calendar]} accountId="account-1" onClose={vi.fn()} onUpdated={vi.fn()}
    />);

    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("declined"));
  });

  it("still renders legacy attendee arrays and malformed JSON without losing the event", async () => {
    const legacy = '[{"email":"legacy@example.com","displayName":"Старый формат","responseStatus":"accepted"}]';
    const { unmount } = render(<EventDetailModal
      event={event({ attendees_json: legacy, organizer_email: "owner@example.com" })}
      calendars={[calendar]} accountId="account-1" onClose={vi.fn()} onUpdated={vi.fn()}
    />);
    expect(await screen.findByText("Старый формат")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    unmount();

    render(<EventDetailModal
      event={event({ attendees_json: "{not json", organizer_email: "owner@example.com" })}
      calendars={[calendar]} accountId="account-1" onClose={vi.fn()} onUpdated={vi.fn()}
    />);
    expect(await screen.findByText("Weekly")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
  });
});
