import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getGmailClient: vi.fn(), getAccount: vi.fn() }));
vi.mock("@/services/gmail/tokenManager", () => ({ getGmailClient: mocks.getGmailClient }));
vi.mock("@/services/db/accounts", () => ({ getAccount: mocks.getAccount }));

import { GoogleCalendarProvider } from "./googleCalendarProvider";

const ACL_SCOPE = "https://www.googleapis.com/auth/calendar.acls";

describe("GoogleCalendarProvider ACL", () => {
  const request = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGmailClient.mockResolvedValue({ request });
    mocks.getAccount.mockResolvedValue({ email: "owner@example.com", oauth_granted_scopes: ACL_SCOPE });
  });

  it("gates unknown legacy scope metadata and enables the official ACL scope", async () => {
    const provider = new GoogleCalendarProvider("account-1");
    await expect(provider.discoverCalendarAcl("calendar-1")).resolves.toMatchObject({ read: "supported", write: "supported" });
    mocks.getAccount.mockResolvedValueOnce({ email: "owner@example.com", oauth_granted_scopes: null });
    await expect(provider.discoverCalendarAcl("calendar-1")).resolves.toMatchObject({
      read: "reauthorization-required", write: "reauthorization-required",
    });
  });

  it("lists paginated ACL entries and normalizes roles/protection", async () => {
    request
      .mockResolvedValueOnce({
        nextPageToken: "next",
        items: [
          { id: "owner-rule", role: "owner", scope: { type: "user", value: "owner@example.com" } },
          { id: "busy-rule", role: "freeBusyReader", scope: { type: "user", value: "busy@example.com" } },
        ],
      })
      .mockResolvedValueOnce({ items: [{ id: "writer-rule", role: "writer", scope: { type: "group", value: "team@example.com" } }] });
    const entries = await new GoogleCalendarProvider("account-1").listCalendarShares("calendar/1");
    expect(entries.map((entry) => entry.role)).toEqual(["owner", "free-busy-only", "writer"]);
    expect(entries[0]).toMatchObject({ isOwner: true, isCurrentUser: true, isProtected: true });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]![0]).toContain("calendars/calendar%2F1/acl?");
    expect(request.mock.calls[1]![0]).toContain("pageToken=next");
  });

  it("uses insert/update/delete endpoints and protects owner entries", async () => {
    const provider = new GoogleCalendarProvider("account-1");
    request.mockResolvedValueOnce({ id: "user:new", role: "reader", scope: { type: "user", value: "new@example.com" } });
    await provider.grantCalendarShare("calendar-1", "new@example.com", "reader");
    expect(request.mock.calls[0]![1]).toMatchObject({ method: "POST" });

    request
      .mockResolvedValueOnce({ id: "user:new", role: "reader", scope: { type: "user", value: "new@example.com" } })
      .mockResolvedValueOnce({ id: "user:new", role: "writer", scope: { type: "user", value: "new@example.com" } });
    await provider.updateCalendarShareRole("calendar-1", "user:new", "writer");
    expect(request.mock.calls[2]![1]).toMatchObject({ method: "PUT" });
    expect(JSON.parse(String(request.mock.calls[2]![1]?.body))).toEqual({
      role: "writer",
      scope: { type: "user", value: "new@example.com" },
    });

    request.mockResolvedValueOnce({ id: "user:new", role: "writer", scope: { type: "user", value: "new@example.com" } });
    request.mockResolvedValueOnce(undefined);
    await provider.revokeCalendarShare("calendar-1", "user:new");
    expect(request.mock.calls[4]![1]).toMatchObject({ method: "DELETE" });

    request.mockResolvedValueOnce({ id: "owner-rule", role: "owner", scope: { type: "user", value: "other@example.com" } });
    await expect(provider.revokeCalendarShare("calendar-1", "owner-rule"))
      .rejects.toMatchObject({ code: "owner-protected", entryId: "owner-rule" });
  });

  it("returns a typed per-entry permission error", async () => {
    request.mockRejectedValueOnce(new Error("Gmail API error: 403 forbidden"));
    await expect(new GoogleCalendarProvider("account-1").revokeCalendarShare("calendar-1", "entry-1"))
      .rejects.toMatchObject({ code: "permission-denied", entryId: "entry-1" });
  });
});
