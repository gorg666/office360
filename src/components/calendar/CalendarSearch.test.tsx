import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarSearch } from "./CalendarSearch";

const mocks = vi.hoisted(() => ({ search: vi.fn(), resolveEvent: vi.fn() }));
vi.mock("@/services/calendar/calendarSearchService", () => ({
  calendarSearchService: { search: mocks.search, resolveEvent: mocks.resolveEvent },
}));

const result = (id: string, title: string) => ({
  eventId: id, eventResourceKey: `remote-${id}`, seriesUid: null, occurrenceKey: null,
  calendarId: "calendar-1", calendarName: "Work", title, location: null,
  startTime: 1_800_000_000, endTime: 1_800_003_600, isAllDay: false, matchedFields: ["title"] as const,
});

describe("CalendarSearch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("debounces search and exposes loading, results and filters", async () => {
    mocks.search.mockResolvedValue([result("one", "Planning")]);
    render(<CalendarSearch accountId="account-1" calendars={[]} currentRange={{ start: 1, end: 2 }} locale="en" debounceMs={1} onOpenEvent={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search calendar events"), { target: { value: "plan" } });
    expect(screen.getByText("Searching…")).toBeInTheDocument();
    expect(await screen.findByText("Planning")).toBeInTheDocument();
    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ query: "plan", range: null, limit: 30 }));
    fireEvent.change(screen.getByLabelText("Date range"), { target: { value: "current" } });
    await waitFor(() => expect(mocks.search).toHaveBeenLastCalledWith(expect.objectContaining({ range: { start: 1, end: 2 } })));
  });

  it("supports Arrow navigation, Enter resolution and Escape", async () => {
    const onOpenEvent = vi.fn();
    const event = { id: "event-two" };
    mocks.search.mockResolvedValue([result("one", "One"), result("two", "Two")]);
    mocks.resolveEvent.mockResolvedValue(event);
    render(<CalendarSearch accountId="account-1" calendars={[]} currentRange={{ start: 1, end: 2 }} locale="en" debounceMs={1} onOpenEvent={onOpenEvent} />);
    const input = screen.getByLabelText("Search calendar events");
    fireEvent.change(input, { target: { value: "event" } });
    await screen.findByText("Two");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.resolveEvent).toHaveBeenCalledWith("account-1", "two"));
    expect(onOpenEvent).toHaveBeenCalledWith(event);
    fireEvent.change(input, { target: { value: "again" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
  });
});
