import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import { calendarMutationService } from "@/services/calendar/calendarMutationService";
import { useAccountStore } from "@/stores/accountStore";
import { availability } from "@/services/calendar/scheduling/testFixtures";
import { participantRefFromEmail, serializeCalendarParticipants, calendarOrganizerFromInput, dedupeCalendarAttendees } from "@/services/calendar/domain";
import type { CandidateSlot, GroupSchedulingResult } from "@/services/calendar/scheduling";
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
};

const fullCapabilities = {
  events: { create: "remote", update: "remote", delete: "remote" },
  recurrence: { updateScopes: ["single", "series"], deleteScopes: ["single", "series"] },
  rsvp: { remote: "direct" },
};

function event(overrides: Partial<DbCalendarEvent> = {}): DbCalendarEvent {
  return {
    id: "event-1", account_id: "account-1", google_event_id: "/cal/series.ics",
    summary: "Weekly", description: null, location: null,
    start_time: 1_800_000_000, end_time: 1_800_003_600, is_all_day: 0,
    status: "confirmed", organizer_email: "owner@example.com", attendees_json: null, html_link: null,
    updated_at: 1, calendar_id: "cal-1", remote_event_id: "/cal/series.ics",
    etag: '"v1"', ical_data: null, uid: "series-1", time_kind: "timed-zoned",
    tzid: "UTC", wall_start: "2027-01-15T08:00:00", wall_end: "2027-01-15T09:00:00",
    end_date_exclusive: null, series_uid: "series-1", occurrence_key: null,
    is_recurrence_master: 0, transp: null, sequence: 3, origin: "remote",
    projection_key: null, projection_status: null, ...overrides,
  };
}

const occurrence = event({ occurrence_key: "series-1::20270115T080000Z" });
const master = event({ is_recurrence_master: 1, occurrence_key: null });
const plain = event({
  uid: "plain-1", series_uid: null, occurrence_key: null, is_recurrence_master: 0,
  summary: "One-off", google_event_id: "/cal/plain.ics", remote_event_id: "/cal/plain.ics",
});

const updateMock = calendarMutationService.update as unknown as ReturnType<typeof vi.fn>;
const deleteMock = calendarMutationService.delete as unknown as ReturnType<typeof vi.fn>;

async function openEditor(target: DbCalendarEvent = occurrence) {
  const onUpdated = vi.fn();
  render(<EventDetailModal
    event={target}
    calendars={[calendar]}
    accountId="account-1"
    timeZone="UTC"
    debounceMs={0}
    onClose={vi.fn()}
    onUpdated={onUpdated}
  />);
  fireEvent.click(await screen.findByRole("button", { name: "Изменить" }));
  expect(await screen.findByText("Изменить событие")).toBeInTheDocument();
  return onUpdated;
}

async function confirmScope(scope: "single" | "series", action: "Сохранить" | "Удалить" = "Сохранить") {
  const dialog = await screen.findByTestId("recurrence-scope-dialog");
  fireEvent.click(within(dialog).getByTestId(`recurrence-scope-${scope}`));
  fireEvent.click(within(dialog).getByRole("button", { name: action }));
}

const DAY = Date.UTC(2027, 0, 15) / 1000;
const SELF = participantRefFromEmail("self@example.com", "Self");
const SCORE: CandidateSlot["score"] = {
  total: 90,
  components: {
    classification: 80, optionalFree: 10, optionalTentative: 0, optionalUnknown: 0,
    optionalBusy: 0, workingHours: 0, earliness: 0,
  },
};

function assistantResult(): GroupSchedulingResult {
  const suggestion: CandidateSlot = {
    start: DAY + 14 * 3600,
    end: DAY + 15 * 3600,
    classification: "confirmed",
    requiredConflicts: [],
    optionalConflicts: [],
    unknownParticipants: [],
    tentativeParticipants: [],
    outsideWorkingHoursParticipants: [],
    score: SCORE,
  };
  return {
    range: { start: DAY, end: DAY + 86400 },
    timeZone: "UTC",
    durationSeconds: 3600,
    granularitySeconds: 1800,
    participants: [{ index: 0, participant: SELF, role: "required", reliability: "known", identityKey: "email:self@example.com" }],
    availability: [availability(SELF, "known", [], { start: DAY, end: DAY + 86400 })],
    segments: [{
      start: DAY, end: DAY + 86400, requiredFree: [0], requiredBusy: [], requiredTentative: [],
      requiredUnknown: [], optionalFree: [], optionalBusy: [], optionalTentative: [], optionalUnknown: [],
      classification: "confirmed",
    }],
    candidates: [suggestion],
    suggestions: [suggestion],
    workingHoursApplied: false,
    workingHoursPolicy: null,
  };
}

describe("EventDetailModal recurring edit UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.setState({
      activeAccountId: "account-1",
      accounts: [{ id: "account-1", email: "self@example.com", displayName: "Self", avatarUrl: null, isActive: true, provider: "caldav" }],
    });
    mocks.capabilities.mockResolvedValue(fullCapabilities);
    updateMock.mockResolvedValue({ status: "success", value: { id: "ok" } });
    deleteMock.mockResolvedValue({ status: "success", value: undefined });
  });

  it("does not show a scope dialog for a non-recurring save", async () => {
    const onUpdated = await openEditor(plain);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("recurrence-scope-dialog")).not.toBeInTheDocument();
    expect(updateMock.mock.calls[0]![0]).toMatchObject({ isRecurring: false, recurrenceScope: undefined });
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("asks for a scope when saving a recurring occurrence", async () => {
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByTestId("recurrence-scope-dialog")).toBeInTheDocument();
    expect(screen.getByText("Изменить повторяющееся событие")).toBeInTheDocument();
    expect(screen.getByText("Только это событие")).toBeInTheDocument();
    expect(screen.getByText("Всю серию")).toBeInTheDocument();
    expect(screen.queryByText("Это и последующие события")).not.toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("calls a single occurrence mutation after choosing single", async () => {
    const onUpdated = await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await confirmScope("single");
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0]![0]).toMatchObject({
      isRecurring: true,
      recurrenceScope: "single",
      seriesUid: "series-1",
      occurrenceKey: "series-1::20270115T080000Z",
    });
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("calls a series mutation after choosing series", async () => {
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await confirmScope("series");
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0]![0]).toMatchObject({
      recurrenceScope: "series",
      seriesUid: "series-1",
      occurrenceKey: undefined,
    });
  });

  it("does not offer single when the editor opened the series master", async () => {
    await openEditor(master);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    const dialog = await screen.findByTestId("recurrence-scope-dialog");
    expect(within(dialog).queryByTestId("recurrence-scope-single")).not.toBeInTheDocument();
    expect(within(dialog).getByTestId("recurrence-scope-series")).toBeInTheDocument();
  });

  it("keeps editor changes when the scope dialog is cancelled", async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Moved weekly" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    fireEvent.click(within(await screen.findByTestId("recurrence-scope-dialog")).getByRole("button", { name: "Отмена" }));
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(screen.getByText("Изменить событие")).toBeInTheDocument();
    expect(screen.getByLabelText("Название")).toHaveValue("Moved weekly");
  });

  it("deletes a single occurrence without a generic series resource delete", async () => {
    render(<EventDetailModal event={occurrence} calendars={[calendar]} accountId="account-1" onClose={vi.fn()} onUpdated={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));
    await confirmScope("single", "Удалить");
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(deleteMock.mock.calls[0]![0]).toMatchObject({
      isRecurring: true,
      recurrenceScope: "single",
      occurrenceKey: "series-1::20270115T080000Z",
      seriesUid: "series-1",
    });
    expect(deleteMock.mock.calls[0]![0].recurrenceScope).not.toBe("series");
  });

  it("deletes the whole series once", async () => {
    render(<EventDetailModal event={occurrence} calendars={[calendar]} accountId="account-1" onClose={vi.fn()} onUpdated={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));
    expect(await screen.findByText("Удалить всю серию событий")).toBeInTheDocument();
    await confirmScope("series", "Удалить");
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(deleteMock.mock.calls[0]![0]).toMatchObject({ recurrenceScope: "series", occurrenceKey: undefined });
  });
});

describe("EventDetailModal recurring scheduling assistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.setState({
      activeAccountId: "account-1",
      accounts: [{ id: "account-1", email: "self@example.com", displayName: "Self", avatarUrl: null, isActive: true, provider: "caldav" }],
    });
    mocks.capabilities.mockResolvedValue(fullCapabilities);
    updateMock.mockResolvedValue({ status: "success", value: { id: "ok" } });
  });

  it("lets a suggestion update occurrence start/end and saves with single scope", async () => {
    const planMeeting = vi.fn(async () => assistantResult());
    render(<EventDetailModal
      event={occurrence}
      calendars={[calendar]}
      accountId="account-1"
      timeZone="UTC"
      planMeeting={planMeeting}
      debounceMs={0}
      onClose={vi.fn()}
      onUpdated={vi.fn()}
    />);
    fireEvent.click(await screen.findByRole("button", { name: "Изменить" }));
    expect(await screen.findByTestId("scheduling-assistant")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("scheduling-suggestion"));
    const start = screen.getByLabelText("Начало") as HTMLInputElement;
    const end = screen.getByLabelText("Окончание") as HTMLInputElement;
    expect(start.value).toContain("T14:00");
    expect(end.value).toContain("T15:00");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await confirmScope("single");
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0]![0]).toMatchObject({ recurrenceScope: "single", occurrenceKey: "series-1::20270115T080000Z" });
    expect(updateMock.mock.calls[0]![1]).toMatchObject({
      startTime: new Date(start.value).toISOString(),
      endTime: new Date(end.value).toISOString(),
    });
  });

  it("does not leak foreign busy titles from the assistant", async () => {
    const poisoned = assistantResult();
    poisoned.availability = [availability(SELF, "known", [
      { start: DAY + 11 * 3600, end: DAY + 12 * 3600, busyType: "busy", title: "Secret board meeting" } as never,
    ], { start: DAY, end: DAY + 86400 })];
    render(<EventDetailModal
      event={occurrence}
      calendars={[calendar]}
      accountId="account-1"
      timeZone="UTC"
      planMeeting={async () => poisoned}
      debounceMs={0}
      onClose={vi.fn()}
      onUpdated={vi.fn()}
    />);
    fireEvent.click(await screen.findByRole("button", { name: "Изменить" }));
    await screen.findByTestId("scheduling-assistant");
    expect(screen.queryByText("Secret board meeting")).not.toBeInTheDocument();
  });
});

describe("EventDetailModal recurring mutation errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.setState({
      activeAccountId: "account-1",
      accounts: [{ id: "account-1", email: "self@example.com", displayName: "Self", avatarUrl: null, isActive: true, provider: "caldav" }],
    });
    mocks.capabilities.mockResolvedValue(fullCapabilities);
  });

  it.each([
    ["conflict", "Событие было изменено в другом месте. Обновите данные и попробуйте снова."],
    ["unsupported", "Этот способ изменения не поддерживается календарём."],
    ["permission-denied", "Недостаточно прав для изменения этого календаря."],
    ["network-error", "Не удалось связаться с сервером календаря. Повторите попытку."],
  ] as const)("keeps the editor open after %s", async (status, copy) => {
    updateMock.mockResolvedValue({ status, message: status });
    const onUpdated = vi.fn();
    render(<EventDetailModal event={occurrence} calendars={[calendar]} accountId="account-1" onClose={vi.fn()} onUpdated={onUpdated} />);
    fireEvent.click(await screen.findByRole("button", { name: "Изменить" }));
    fireEvent.click(await screen.findByRole("button", { name: "Сохранить" }));
    await confirmScope("single");
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
    expect(screen.getByText("Изменить событие")).toBeInTheDocument();
    expect(onUpdated).not.toHaveBeenCalled();
  });
});

describe("EventDetailModal participant envelope still renders with recurrence helpers", () => {
  it("keeps canonical attendees when opening a recurring occurrence", async () => {
    mocks.capabilities.mockResolvedValue(fullCapabilities);
    useAccountStore.setState({
      activeAccountId: "account-1",
      accounts: [{ id: "account-1", email: "self@example.com", displayName: "Self", avatarUrl: null, isActive: true, provider: "caldav" }],
    });
    const attendees_json = serializeCalendarParticipants({
      organizer: calendarOrganizerFromInput({ email: "owner@example.com", displayName: "Владелец" }),
      attendees: dedupeCalendarAttendees([{ email: "req@example.com", displayName: "Обязательный", responseStatus: "accepted" }]),
    });
    render(<EventDetailModal
      event={event({ occurrence_key: "series-1::20270115T080000Z", attendees_json, organizer_email: "owner@example.com" })}
      calendars={[calendar]}
      accountId="account-1"
      onClose={vi.fn()}
      onUpdated={vi.fn()}
    />);
    expect(await screen.findByText("Владелец")).toBeInTheDocument();
    expect(screen.getByText("Обязательный")).toBeInTheDocument();
  });
});
