import type { CalendarProvider } from "./types";
import { calendarMutationService, classifyWriteFailure } from "./calendarMutationService";
import { getCalendarProvider } from "./providerFactory";
import { getCalendarByRemoteId } from "@/services/db/calendars";
import { refreshCalendarAccess } from "./calendarAccessService";

const { mockAccessForCalendar } = vi.hoisted(() => ({ mockAccessForCalendar: vi.fn() }));

vi.mock("./providerFactory", () => ({ getCalendarProvider: vi.fn() }));
vi.mock("@/services/db/calendars", () => ({
  getCalendarByRemoteId: vi.fn(),
  accessForCalendar: mockAccessForCalendar,
}));
vi.mock("./calendarAccessService", () => ({ refreshCalendarAccess: vi.fn() }));

const capabilities = {
  version: 5 as const,
  read: { calendars: "full" as const, events: "full" as const },
  events: { create: "remote" as const, update: "remote" as const, delete: "remote" as const },
  recurrence: {
    read: "full" as const,
    write: "partial" as const,
    updateScopes: ["single", "series"] as const,
    deleteScopes: ["single", "series"] as const,
  },
  attendees: { read: "partial" as const, write: "partial" as const },
  rsvp: { local: "projection" as const, remote: "direct" as const },
  invitations: "none" as const,
  sync: { mode: "range-refresh" as const, pagination: false, durability: "ephemeral" as const },
  freeBusy: { self: "local-derived" as const, others: "none" as const },
  permissions: "none" as const,
  sharedCalendars: "read" as const,
  calendarAccess: { discovery: "full" as const, ownership: "partial" as const, effectivePermissions: "partial" as const, aclRead: "partial" as const, aclWrite: "none" as const },
  reminders: {
    read: "partial" as const, write: "partial" as const, multiple: true,
    methods: ["notification"] as const, defaults: "none" as const, maxCount: null,
  },
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
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    vi.mocked(getCalendarByRemoteId).mockResolvedValue({ access_json: "writable" } as never);
    mockAccessForCalendar.mockReturnValue({ permissions: { canCreate: true, canUpdate: true, canDelete: true } });
    vi.mocked(refreshCalendarAccess).mockResolvedValue([]);
  });

  it("blocks offline writes without provider I/O or silent queueing", async () => {
    const mockProvider = provider();
    vi.mocked(getCalendarProvider).mockResolvedValue(mockProvider);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const result = await calendarMutationService.create("acc-1", "cal", {
      summary: "Offline", startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T11:00:00Z",
    });

    expect(result).toMatchObject({ status: "offline" });
    expect(mockProvider.createEvent).not.toHaveBeenCalled();
    expect(getCalendarProvider).not.toHaveBeenCalled();
  });

  it("blocks a read-only calendar before provider I/O", async () => {
    const mockProvider = provider();
    vi.mocked(getCalendarProvider).mockResolvedValue(mockProvider);
    mockAccessForCalendar.mockReturnValue({ permissions: { canCreate: false, canUpdate: false, canDelete: false } });

    const result = await calendarMutationService.create("acc-1", "readonly", { summary: "No", startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T11:00:00Z" });

    expect(result.status).toBe("read-only");
    expect(mockProvider.createEvent).not.toHaveBeenCalled();
  });

  it("refreshes access once after a provider permission denial without retrying the write", async () => {
    const mockProvider = provider();
    vi.mocked(getCalendarProvider).mockResolvedValue(mockProvider);
    vi.mocked(mockProvider.deleteEvent).mockRejectedValue(new Error("403 permission denied"));

    const result = await calendarMutationService.delete({ accountId: "acc-1", calendarRemoteId: "cal", remoteEventId: "event" });

    expect(result.status).toBe("permission-denied");
    expect(mockProvider.deleteEvent).toHaveBeenCalledTimes(1);
    expect(refreshCalendarAccess).toHaveBeenCalledTimes(1);
  });
  it("blocks this-and-future before a provider call", async () => {
    const mockProvider = provider();
    vi.mocked(getCalendarProvider).mockResolvedValue(mockProvider);

    const result = await calendarMutationService.delete({
      accountId: "acc-1", calendarRemoteId: "cal", remoteEventId: "series.ics",
      isRecurring: true, recurrenceScope: "this-and-future", seriesUid: "uid-1",
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
      isRecurring: true, recurrenceScope: "series", seriesUid: "uid-1", etag: '"v1"',
    });

    expect(result.status).toBe("success");
    expect(mockProvider.deleteEvent).toHaveBeenCalledWith("cal", "series.ics", '"v1"', {
      scope: "series", seriesUid: "uid-1",
    });
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
      "cal", "event", { summary: "Updated", sequence: 6 }, undefined, undefined,
    );
  });

  it("passes a decoded canonical occurrence identity to the provider", async () => {
    const mockProvider = provider();
    vi.mocked(getCalendarProvider).mockResolvedValue(mockProvider);
    vi.mocked(mockProvider.updateEvent).mockResolvedValue({} as never);
    const occurrenceKey = "uid-1|Z|America%2FNew_York|20261101T013000";

    const result = await calendarMutationService.update({
      accountId: "acc-1", calendarRemoteId: "cal", remoteEventId: "series.ics",
      isRecurring: true, recurrenceScope: "single", seriesUid: "uid-1", occurrenceKey,
    }, { summary: "Only this one" });

    expect(result.status).toBe("success");
    expect(mockProvider.updateEvent).toHaveBeenCalledWith("cal", "series.ics", { summary: "Only this one" }, undefined, {
      scope: "single",
      seriesUid: "uid-1",
      occurrence: {
        key: occurrenceKey,
        identity: { kind: "timed-zoned", tzid: "America/New_York", wall: { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 } },
      },
    });
  });

  it("rejects a mismatched occurrence identity before provider I/O", async () => {
    const mockProvider = provider();
    vi.mocked(getCalendarProvider).mockResolvedValue(mockProvider);
    const result = await calendarMutationService.delete({
      accountId: "acc-1", calendarRemoteId: "cal", remoteEventId: "series.ics",
      isRecurring: true, recurrenceScope: "single", seriesUid: "uid-1",
      occurrenceKey: "different-uid|D|20260101",
    });
    expect(result.status).toBe("unsupported");
    expect(mockProvider.deleteEvent).not.toHaveBeenCalled();
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

  it("rejects unsupported reminder semantics before provider I/O", async () => {
    const mockProvider = provider();
    vi.mocked(getCalendarProvider).mockResolvedValue(mockProvider);

    const result = await calendarMutationService.create("acc-1", "cal", {
      summary: "Email reminder", startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T11:00:00Z",
      reminders: { kind: "custom", reminders: [{ method: "email", trigger: { kind: "before-start", duration: { seconds: 900 } } }] },
    });

    expect(result.status).toBe("unsupported");
    expect(mockProvider.createEvent).not.toHaveBeenCalled();
  });

  it("passes supported multiple reminder semantics to the provider", async () => {
    const mockProvider = provider();
    vi.mocked(getCalendarProvider).mockResolvedValue(mockProvider);
    vi.mocked(mockProvider.createEvent).mockResolvedValue({} as never);
    const reminders = {
      kind: "custom" as const,
      reminders: [
        { method: "notification" as const, trigger: { kind: "before-start" as const, duration: { seconds: 86400 } } },
        { method: "notification" as const, trigger: { kind: "before-start" as const, duration: { seconds: 600 } } },
      ],
    };

    const result = await calendarMutationService.create("acc-1", "cal", {
      summary: "Supported", startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T11:00:00Z", reminders,
    });

    expect(result.status).toBe("success");
    expect(mockProvider.createEvent).toHaveBeenCalledWith("cal", expect.objectContaining({ reminders }));
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
