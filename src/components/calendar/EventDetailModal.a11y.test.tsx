import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { useAccountStore } from "@/stores/accountStore";
import { EventDetailModal } from "./EventDetailModal";
import { googleCalendarAccess, serializeCalendarAccess } from "@/services/calendar/domain";

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
    id: "event-1", account_id: "account-1", google_event_id: "/cal/plain.ics",
    summary: "Standup", description: null, location: null,
    start_time: 1_800_000_000, end_time: 1_800_003_600, is_all_day: 0,
    status: "confirmed", organizer_email: null, attendees_json: null, html_link: null,
    updated_at: 1, calendar_id: "cal-1", remote_event_id: "/cal/plain.ics",
    etag: '"v1"', ical_data: null, uid: "plain-1", time_kind: "timed-zoned",
    tzid: "UTC", wall_start: "2027-01-15T08:00:00", wall_end: "2027-01-15T09:00:00",
    end_date_exclusive: null, series_uid: null, occurrence_key: null,
    is_recurrence_master: 0, transp: null, sequence: 0, origin: "remote",
    projection_key: null, projection_status: null, ...overrides,
  };
}

const capabilities = {
  events: { create: "remote", update: "remote", delete: "remote" },
  recurrence: { updateScopes: ["single", "series"], deleteScopes: ["single", "series"] },
  rsvp: { remote: "direct" },
};

describe("EventDetailModal keyboard resize equivalent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.setState({
      activeAccountId: "account-1",
      accounts: [{
        id: "account-1", email: "self@example.com", displayName: "Self",
        avatarUrl: null, isActive: true, provider: "caldav",
      }],
    });
    mocks.capabilities.mockResolvedValue(capabilities);
  });

  it("lets a keyboard user change start and end through Event Edit", async () => {
    render(<EventDetailModal
      event={event()}
      calendars={[calendar]}
      accountId="account-1"
      timeZone="UTC"
      debounceMs={0}
      onClose={vi.fn()}
      onUpdated={vi.fn()}
    />);

    const edit = await screen.findByRole("button", { name: "Изменить" });
    edit.focus();
    expect(edit).toHaveFocus();
    fireEvent.click(edit);

    const start = screen.getByLabelText("Начало");
    const end = screen.getByLabelText("Окончание");
    start.focus();
    expect(start).toHaveFocus();
    fireEvent.change(start, { target: { value: "2027-01-16T09:00" } });
    fireEvent.change(end, { target: { value: "2027-01-16T10:00" } });
    expect(start).toHaveValue("2027-01-16T09:00");
    expect(end).toHaveValue("2027-01-16T10:00");
  });
});
