import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { googleCalendarAccess, participantRefFromEmail, serializeCalendarAccess, type CalendarShareEntry } from "@/services/calendar/domain";
import type { DbCalendar } from "@/services/db/calendars";

const aclMocks = vi.hoisted(() => ({
  capabilities: vi.fn(), list: vi.fn(), grant: vi.fn(), updateRole: vi.fn(), revoke: vi.fn(),
}));
vi.mock("@/services/calendar/calendarAclService", () => ({ calendarAclService: aclMocks }));

import { CalendarAclDialog } from "./CalendarAclDialog";

const calendar: DbCalendar = {
  id: "calendar-1", account_id: "account-1", provider: "google_api", remote_id: "remote-1",
  display_name: "Команда", color: null, is_primary: 1, is_visible: 1, sync_token: null, ctag: null,
  created_at: 1, updated_at: 1, access_json: serializeCalendarAccess(googleCalendarAccess("owner", true)),
  access_observed_at: 1, provider_presence: "present", provider_seen_at: 1,
};

const guest: CalendarShareEntry = {
  id: "guest", participant: participantRefFromEmail("guest@example.com"), principalType: "user",
  principalValue: "guest@example.com", displayName: null, role: "reader",
  isCurrentUser: false, isOwner: false, isProtected: false,
};

describe("CalendarAclDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aclMocks.capabilities.mockResolvedValue({ read: "supported", write: "supported", reason: null });
    aclMocks.list.mockResolvedValue([guest]);
    aclMocks.grant.mockResolvedValue(guest);
    aclMocks.updateRole.mockResolvedValue({ ...guest, role: "writer" });
    aclMocks.revoke.mockResolvedValue(undefined);
  });

  it("adds, changes and removes sharing through the provider-neutral service", async () => {
    render(<CalendarAclDialog accountId="account-1" calendar={calendar} onClose={vi.fn()} />);
    expect(await screen.findByText("guest@example.com")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Роль guest@example.com"), { target: { value: "writer" } });
    await waitFor(() => expect(aclMocks.updateRole).toHaveBeenCalledWith(
      { accountId: "account-1", calendarId: "calendar-1" }, "guest", "writer",
    ));

    fireEvent.change(screen.getByLabelText("Добавить человека"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Новая роль"), { target: { value: "free-busy-only" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(aclMocks.grant).toHaveBeenCalledWith(
      { accountId: "account-1", calendarId: "calendar-1" }, "new@example.com", "free-busy-only",
    ));

    fireEvent.click(screen.getByRole("button", { name: "Удалить доступ guest@example.com" }));
    await waitFor(() => expect(aclMocks.revoke).toHaveBeenCalledWith(
      { accountId: "account-1", calendarId: "calendar-1" }, "guest",
    ));
  });

  it("shows unsupported state without active mutation controls", async () => {
    aclMocks.capabilities.mockResolvedValue({ read: "unsupported", write: "unsupported", reason: "provider-contract-missing" });
    render(<CalendarAclDialog accountId="account-1" calendar={calendar} onClose={vi.fn()} />);
    expect(await screen.findByText("Управление доступом не поддерживается этим календарём.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Добавить" })).not.toBeInTheDocument();
    expect(aclMocks.list).not.toHaveBeenCalled();
  });

  it("keeps owner/current-user controls disabled", async () => {
    aclMocks.list.mockResolvedValue([{ ...guest, id: "owner", role: "owner", isOwner: true, isCurrentUser: true, isProtected: true }]);
    render(<CalendarAclDialog accountId="account-1" calendar={calendar} onClose={vi.fn()} />);
    const role = await screen.findByLabelText("Роль guest@example.com");
    expect(role).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Удалить доступ guest@example.com" })).not.toBeInTheDocument();
  });
});
