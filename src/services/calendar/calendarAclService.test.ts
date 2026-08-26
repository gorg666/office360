import { describe, expect, it, vi } from "vitest";
import { CalendarAclError, googleCalendarAccess, participantRefFromEmail, serializeCalendarAccess, type CalendarShareEntry } from "./domain";
import { CalendarAclService } from "./calendarAclService";
import type { CalendarProvider } from "./types";
import type { DbCalendar } from "@/services/db/calendars";

const entry = (overrides: Partial<CalendarShareEntry> = {}): CalendarShareEntry => ({
  id: "user:guest@example.com",
  participant: participantRefFromEmail("guest@example.com"),
  principalType: "user",
  principalValue: "guest@example.com",
  displayName: null,
  role: "reader",
  isCurrentUser: false,
  isOwner: false,
  isProtected: false,
  ...overrides,
});

const calendar = (role = "owner"): DbCalendar => ({
  id: "calendar-local", account_id: "account-1", provider: "google_api", remote_id: "calendar-remote",
  display_name: "Work", color: null, is_primary: 1, is_visible: 1, sync_token: null, ctag: null,
  created_at: 1, updated_at: 1, access_json: serializeCalendarAccess(googleCalendarAccess(role, true)),
  access_observed_at: 1, provider_presence: "present", provider_seen_at: 1,
});

function setup(entries: CalendarShareEntry[] = [entry()]) {
  const provider = {
    accountId: "account-1", type: "google_api",
    capabilities: {},
    discoverCalendarAcl: vi.fn().mockResolvedValue({ read: "supported", write: "supported", reason: null }),
    listCalendarShares: vi.fn().mockResolvedValue(entries),
    grantCalendarShare: vi.fn().mockImplementation((_calendarId, email, role) => Promise.resolve(entry({
      id: `user:${email}`, participant: participantRefFromEmail(email), principalValue: email, role,
    }))),
    updateCalendarShareRole: vi.fn().mockImplementation((_calendarId, id, role) => Promise.resolve(entry({ id, role }))),
    revokeCalendarShare: vi.fn().mockResolvedValue(undefined),
  } as unknown as CalendarProvider & Record<string, ReturnType<typeof vi.fn>>;
  const refresh = vi.fn().mockResolvedValue([]);
  const getCalendarById = vi.fn().mockResolvedValue(calendar());
  const service = new CalendarAclService({
    getCalendarById,
    getCalendarProvider: vi.fn().mockResolvedValue(provider),
    refreshCalendarAccess: refresh,
  });
  return { service, provider, refresh, getCalendarById };
}

describe("CalendarAclService", () => {
  it("lists through the provider-neutral contract", async () => {
    const { service, provider } = setup();
    await expect(service.list({ accountId: "account-1", calendarId: "calendar-local" })).resolves.toEqual([entry()]);
    expect(provider.listCalendarShares).toHaveBeenCalledWith("calendar-remote");
  });

  it("normalizes email, prevents duplicates and refreshes CAL-119 metadata after grant", async () => {
    const duplicate = setup([entry()]);
    await expect(duplicate.service.grant(
      { accountId: "account-1", calendarId: "calendar-local" }, " MAILTO:Guest@Example.com ", "reader",
    )).rejects.toMatchObject({ code: "duplicate-principal" });
    expect(duplicate.provider.grantCalendarShare).not.toHaveBeenCalled();

    const success = setup([]);
    await success.service.grant(
      { accountId: "account-1", calendarId: "calendar-local" }, " New@Example.com ", "free-busy-only",
    );
    expect(success.provider.grantCalendarShare).toHaveBeenCalledWith("calendar-remote", "new@example.com", "free-busy-only");
    expect(success.refresh).toHaveBeenCalledWith("account-1", success.provider);
  });

  it.each([
    entry({ id: "owner", role: "owner", isOwner: true, isProtected: true }),
    entry({ id: "self", isCurrentUser: true, isProtected: true }),
  ])("protects owner/current-user entry $id", async (protectedEntry) => {
    const { service, provider } = setup([protectedEntry]);
    await expect(service.revoke(
      { accountId: "account-1", calendarId: "calendar-local" }, protectedEntry.id,
    )).rejects.toBeInstanceOf(CalendarAclError);
    expect(provider.revokeCalendarShare).not.toHaveBeenCalled();
  });

  it("keeps read-only CAL-119 calendars non-writable before provider mutation calls", async () => {
    const { service, provider, getCalendarById } = setup();
    getCalendarById.mockResolvedValue(calendar("reader"));
    await expect(service.grant(
      { accountId: "account-1", calendarId: "calendar-local" }, "new@example.com", "reader",
    ))
      .rejects.toMatchObject({ code: "permission-denied" });
    expect(provider.grantCalendarShare).not.toHaveBeenCalled();
  });

  it("reports refresh failure without retrying the completed ACL mutation", async () => {
    const { service, provider, refresh } = setup();
    refresh.mockRejectedValue(new Error("offline"));
    await expect(service.updateRole(
      { accountId: "account-1", calendarId: "calendar-local" }, "user:guest@example.com", "writer",
    )).rejects.toMatchObject({ code: "refresh-failed" });
    expect(provider.updateCalendarShareRole).toHaveBeenCalledTimes(1);
  });
});
