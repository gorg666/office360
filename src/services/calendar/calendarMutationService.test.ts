import type { CalendarProvider } from "./types";
import { calendarMutationService, classifyWriteFailure } from "./calendarMutationService";
import { getCalendarProvider } from "./providerFactory";

vi.mock("./providerFactory", () => ({ getCalendarProvider: vi.fn() }));

const capabilities = {
  version: 2 as const,
  read: { calendars: "full" as const, events: "full" as const },
  events: { create: "remote" as const, update: "remote" as const, delete: "remote" as const },
  recurrence: {
    read: "full" as const,
    write: "partial" as const,
    updateScopes: ["series"] as const,
    deleteScopes: ["series"] as const,
  },
  attendees: { read: "partial" as const, write: "partial" as const },
  rsvp: { local: "projection" as const, remote: "direct" as const },
  invitations: "none" as const,
  sync: { mode: "range-refresh" as const, pagination: false, durability: "ephemeral" as const },
  freeBusy: "none" as const,
  permissions: "none" as const,
  sharedCalendars: "read" as const,
  reminders: "none" as const,
  conflictDetection: "etag" as const,
};

function provider(): CalendarProvider {
  return {
    accountId: "acc-1", type: "caldav", capabilities,
    listCalendars: vi.fn(), fetchEvents: vi.fn(), syncEvents: vi.fn(), testConnection: vi.fn(),
    createEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(), respondToEvent: vi.fn(),
  };
}

describe("CalendarMutationService", () => {
  it("blocks occurrence deletion before a series-only provider call", async () => {
    const mockProvider = provider();
    vi.mocked(getCalendarProvider).mockResolvedValue(mockProvider);

    const result = await calendarMutationService.delete({
      accountId: "acc-1", calendarRemoteId: "cal", remoteEventId: "series.ics",
      isRecurring: true, recurrenceScope: "single",
    });

    expect(result.status).toBe("unsupported");
    expect(mockProvider.deleteEvent).not.toHaveBeenCalled();
  });

  it("allows an explicitly supported series deletion", async () => {
    const mockProvider = provider();
    vi.mocked(getCalendarProvider).mockResolvedValue(mockProvider);
    vi.mocked(mockProvider.deleteEvent).mockResolvedValue();

    const result = await calendarMutationService.delete({
      accountId: "acc-1", calendarRemoteId: "cal", remoteEventId: "series.ics",
      isRecurring: true, recurrenceScope: "series", etag: '"v1"',
    });

    expect(result.status).toBe("success");
    expect(mockProvider.deleteEvent).toHaveBeenCalledWith("cal", "series.ics", '"v1"');
  });

  it("does not let an update decrease the cached sequence", async () => {
    const mockProvider = provider();
    vi.mocked(getCalendarProvider).mockResolvedValue(mockProvider);
    vi.mocked(mockProvider.updateEvent).mockResolvedValue({} as never);

    const result = await calendarMutationService.update({
      accountId: "acc-1", calendarRemoteId: "cal", remoteEventId: "event",
      baseSequence: 5,
    }, { summary: "Updated", sequence: 2 });

    expect(result.status).toBe("success");
    expect(mockProvider.updateEvent).toHaveBeenCalledWith(
      "cal", "event", { summary: "Updated", sequence: 6 }, undefined,
    );
  });

  it("returns typed unsupported without invoking a disabled action", async () => {
    const mockProvider = provider();
    vi.mocked(getCalendarProvider).mockResolvedValue({
      ...mockProvider,
      capabilities: { ...capabilities, events: { ...capabilities.events, create: "unsupported" } },
    });

    const result = await calendarMutationService.create("acc-1", "cal", {
      summary: "Blocked", startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T11:00:00Z",
    });

    expect(result.status).toBe("unsupported");
    expect(mockProvider.createEvent).not.toHaveBeenCalled();
  });

  it("classifies conflicts without exposing raw provider details", () => {
    expect(classifyWriteFailure(new Error("Gmail API error: 412 private response body"))).toEqual({
      status: "conflict",
      message: "Событие изменилось на сервере. Обновите календарь и повторите действие.",
    });
  });

  it("sanitizes provider resolution failures before returning to UI", async () => {
    vi.mocked(getCalendarProvider).mockRejectedValueOnce(
      new Error("Account private-account-id missing provider secret metadata"),
    );

    const result = await calendarMutationService.delete({
      accountId: "private-account-id", calendarRemoteId: "cal", remoteEventId: "event",
    });

    expect(result).toEqual({
      status: "provider-error",
      message: "Не удалось выполнить операцию с календарём.",
    });
    expect(JSON.stringify(result)).not.toContain("private-account-id");
    expect(JSON.stringify(result)).not.toContain("secret metadata");
  });
});
