// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopPlatform } from "@/utils/desktopPlatform";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";

const mocks = vi.hoisted(() => ({
  platform: "macos" as DesktopPlatform,
  cefNavigate: vi.fn(),
  openUrl: vi.fn(),
  navigateToLabel: vi.fn(),
}));

vi.mock("@/utils/desktopPlatform", () => ({
  getDesktopPlatform: vi.fn(async () => mocks.platform),
}));
vi.mock("@/services/cef", () => ({ cefNavigate: mocks.cefNavigate }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@/router/navigate", () => ({ navigateToLabel: mocks.navigateToLabel }));
vi.mock("@/stores/accountStore", () => ({
  useAccountStore: (selector: (state: { accounts: { id: string; email: string }[] }) => unknown) =>
    selector({ accounts: [{ id: "account-1", email: "person@example.test" }] }),
}));

import { EventDetailModal } from "./EventDetailModal";

const JOIN_URL = "https://telemost.yandex.ru/j/123456789";

function eventWithMeeting(): DbCalendarEvent {
  return {
    id: "event-1",
    account_id: "account-1",
    google_event_id: "g-1",
    summary: "Standup",
    description: `Join: ${JOIN_URL}`,
    location: null,
    start_time: 1_700_000_000,
    end_time: 1_700_003_600,
    is_all_day: 0,
    status: "confirmed",
    organizer_email: "person@example.test",
    attendees_json: null,
    html_link: null,
    updated_at: 1_700_000_000,
    calendar_id: "cal-1",
    remote_event_id: "remote-1",
    etag: null,
    ical_data: null,
    uid: "uid-1",
  };
}

describe("EventDetailModal Telemost open", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.platform = "macos";
    sessionStorage.clear();
  });

  it("opens a Telemost join URL on macOS without CEF", async () => {
    render(
      <EventDetailModal
        event={eventWithMeeting()}
        calendars={[]}
        accountId="account-1"
        onClose={() => undefined}
        onUpdated={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Открыть в Телемосте" }));
    await waitFor(() => expect(mocks.navigateToLabel).toHaveBeenCalledWith("telemost"));
    expect(sessionStorage.getItem("office360_telemost_open_event_id")).toBe("event-1");
    await waitFor(() => expect(mocks.cefNavigate).not.toHaveBeenCalled());
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("keeps Windows calendar join on CEF", async () => {
    mocks.platform = "windows";
    render(
      <EventDetailModal
        event={eventWithMeeting()}
        calendars={[]}
        accountId="account-1"
        onClose={() => undefined}
        onUpdated={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Открыть в Телемосте" }));
    await waitFor(() => expect(mocks.navigateToLabel).toHaveBeenCalledWith("telemost"));
    await waitFor(() => expect(mocks.cefNavigate).toHaveBeenCalledWith(JOIN_URL));
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });
});
