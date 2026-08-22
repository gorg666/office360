import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { CalendarProviderCapabilities } from "@/services/calendar/domain";
import { calendarDateToUnixSeconds } from "@/services/calendar/domain";
import { MonthView } from "./MonthView";

const capabilities = {
  events: { create: "remote", update: "remote", delete: "remote" },
  recurrence: { updateScopes: ["single", "series"], deleteScopes: ["single", "series"] },
} as CalendarProviderCapabilities;

function localUnix(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Math.floor(new Date(year, month - 1, day, hour, minute, 0, 0).getTime() / 1000);
}

function event(overrides: Partial<DbCalendarEvent> = {}): DbCalendarEvent {
  return {
    id: "event-1", account_id: "account-1", google_event_id: "/cal/plain.ics",
    summary: "Standup", description: null, location: null,
    start_time: localUnix(2026, 8, 22, 14, 30), end_time: localUnix(2026, 8, 22, 15, 30),
    is_all_day: 0, status: "confirmed", organizer_email: null, attendees_json: null,
    html_link: null, updated_at: 1, calendar_id: "cal-1", remote_event_id: "/cal/plain.ics",
    etag: '"v1"', ical_data: null, uid: "plain-1", time_kind: "timed-zoned",
    tzid: "UTC", wall_start: "2026-08-22T14:30:00", wall_end: "2026-08-22T15:30:00",
    end_date_exclusive: null, series_uid: null, occurrence_key: null,
    is_recurrence_master: 0, transp: null, sequence: 0, origin: "remote",
    projection_key: null, projection_status: null, ...overrides,
  };
}

function allDay(id: string, startDate: string, endDateExclusive: string, summary: string): DbCalendarEvent {
  return event({
    id,
    summary,
    is_all_day: 1,
    time_kind: "all-day",
    tzid: null,
    wall_start: null,
    wall_end: null,
    start_time: calendarDateToUnixSeconds(startDate as `${number}-${number}-${number}`),
    end_time: calendarDateToUnixSeconds(endDateExclusive as `${number}-${number}-${number}`),
    end_date_exclusive: endDateExclusive,
  });
}

function layoutMonthCells() {
  const cells = document.querySelectorAll<HTMLElement>("[data-calendar-date]");
  cells.forEach((cell, index) => {
    const col = index % 7;
    const row = Math.floor(index / 7);
    vi.spyOn(cell, "getBoundingClientRect").mockReturnValue({
      x: col * 100, y: row * 80, left: col * 100, top: row * 80,
      right: col * 100 + 100, bottom: row * 80 + 80, width: 100, height: 80,
      toJSON() { return {}; },
    });
  });
}

function cellPoint(date: string) {
  const rect = screen.getByTestId(`month-cell-${date}`).getBoundingClientRect();
  return { x: rect.left + 10, y: rect.top + 40 };
}

describe("MonthView date drag", () => {
  const august = new Date(2026, 7, 1);

  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  it("opens details on click and ignores a tiny pointer wobble", () => {
    const onEventClick = vi.fn();
    const onDateCommit = vi.fn();
    render(<MonthView
      currentDate={august}
      events={[event()]}
      capabilities={capabilities}
      onEventClick={onEventClick}
      onDateCommit={onDateCommit}
    />);
    layoutMonthCells();
    const button = screen.getByRole("button", { name: /Standup/ });
    const from = cellPoint("2026-08-22");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: from.x + 3, clientY: from.y + 3 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: from.x + 3, clientY: from.y + 3 });
    fireEvent.click(button);
    expect(onDateCommit).not.toHaveBeenCalled();
    expect(onEventClick).toHaveBeenCalledTimes(1);
  });

  it("previews the target date then commits a same-week timed move once", () => {
    const onDateCommit = vi.fn();
    render(<MonthView
      currentDate={august}
      events={[event()]}
      capabilities={capabilities}
      onEventClick={vi.fn()}
      onDateCommit={onDateCommit}
    />);
    layoutMonthCells();
    const button = screen.getByRole("button", { name: /Standup/ });
    const from = cellPoint("2026-08-22");
    const to = cellPoint("2026-08-24");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: to.x, clientY: to.y });
    expect(screen.getByTestId("month-drag-preview")).toHaveTextContent("Standup");
    fireEvent.pointerUp(button, { pointerId: 1, clientX: to.x, clientY: to.y });
    expect(onDateCommit).toHaveBeenCalledTimes(1);
    expect(onDateCommit.mock.calls[0]![1]).toEqual({ type: "shift", deltaDays: 2 });
  });

  it("moves a timed event across a week and month boundary", () => {
    const onDateCommit = vi.fn();
    render(<MonthView
      currentDate={august}
      events={[event()]}
      capabilities={capabilities}
      onEventClick={vi.fn()}
      onDateCommit={onDateCommit}
    />);
    layoutMonthCells();
    const button = screen.getByRole("button", { name: /Standup/ });
    const from = cellPoint("2026-08-22");
    const nextMonth = cellPoint("2026-09-01");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: nextMonth.x, clientY: nextMonth.y });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: nextMonth.x, clientY: nextMonth.y });
    expect(onDateCommit.mock.calls[0]![1]).toEqual({ type: "shift", deltaDays: 10 });
  });

  it("shifts a multi-day all-day span from the grabbed start day", () => {
    const onDateCommit = vi.fn();
    render(<MonthView
      currentDate={august}
      events={[allDay("span-1", "2026-08-20", "2026-08-23", "Offsite")]}
      capabilities={capabilities}
      onEventClick={vi.fn()}
      onDateCommit={onDateCommit}
    />);
    layoutMonthCells();
    const button = screen.getAllByRole("button", { name: /Offsite/ })[0]!;
    const from = cellPoint("2026-08-20");
    const to = cellPoint("2026-08-25");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: to.x, clientY: to.y });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: to.x, clientY: to.y });
    expect(onDateCommit.mock.calls[0]![1]).toEqual({ type: "shift", deltaDays: 5 });
  });

  it("recomputes overflow packing from visual overrides", () => {
    const crowded = [1, 2, 3, 4].map((n) => event({
      id: `event-${n}`,
      summary: `Item ${n}`,
      start_time: localUnix(2026, 8, 22, 10 + n),
      end_time: localUnix(2026, 8, 22, 11 + n),
    }));
    render(<MonthView
      currentDate={august}
      events={crowded}
      capabilities={capabilities}
      onEventClick={vi.fn()}
      visualOverrides={{
        "event-4": {
          start_time: localUnix(2026, 8, 24, 14),
          end_time: localUnix(2026, 8, 24, 15),
        },
      }}
    />);
    expect(screen.getByTestId("month-cell-2026-08-22")).not.toHaveTextContent("ещё");
    expect(screen.getByTestId("month-cell-2026-08-24")).toHaveTextContent("Item 4");
  });

  it("does not start a month drag on a read-only event", () => {
    const onDateCommit = vi.fn();
    render(<MonthView
      currentDate={august}
      events={[event()]}
      capabilities={{ ...capabilities, events: { create: "remote", update: "unsupported", delete: "remote" } }}
      onEventClick={vi.fn()}
      onDateCommit={onDateCommit}
    />);
    layoutMonthCells();
    const button = screen.getByRole("button", { name: /Standup/ });
    const from = cellPoint("2026-08-22");
    const to = cellPoint("2026-08-24");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: to.x, clientY: to.y });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: to.x, clientY: to.y });
    expect(onDateCommit).not.toHaveBeenCalled();
  });

  it("keeps month event cards keyboard-focusable with an aria-label", () => {
    render(<MonthView
      currentDate={august}
      events={[event()]}
      capabilities={capabilities}
      onEventClick={vi.fn()}
      onDateCommit={vi.fn()}
    />);
    const button = screen.getByRole("button", { name: /Standup/ });
    button.focus();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-label");
    expect(button).not.toHaveAttribute("tabIndex", "-1");
  });
});

describe("MonthView create selection", () => {
  const august = new Date(2026, 7, 1);

  it("creates an all-day draft from an empty in-month cell", () => {
    const onCreate = vi.fn();
    render(<MonthView
      currentDate={august}
      events={[]}
      capabilities={capabilities}
      onEventClick={vi.fn()}
      onCreateDraft={onCreate}
    />);
    fireEvent.click(screen.getByTestId("month-cell-2026-08-27"));
    expect(onCreate).toHaveBeenCalledWith({
      kind: "all-day",
      startDate: "2026-08-27",
      endDateExclusive: "2026-08-28",
    });
  });

  it("uses the spillover cell date, not the visible month number", () => {
    const onCreate = vi.fn();
    render(<MonthView
      currentDate={august}
      events={[]}
      capabilities={capabilities}
      onEventClick={vi.fn()}
      onCreateDraft={onCreate}
    />);
    fireEvent.click(screen.getByTestId("month-cell-2026-07-26"));
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ startDate: "2026-07-26" });
  });

  it("does not create from an event card or overflow control", () => {
    const onCreate = vi.fn();
    const onEventClick = vi.fn();
    const crowded = Array.from({ length: 4 }, (_, index) => event({
      id: `event-${index + 1}`,
      summary: `Item ${index + 1}`,
      start_time: localUnix(2026, 8, 24, 9 + index),
      end_time: localUnix(2026, 8, 24, 10 + index),
    }));
    render(<MonthView
      currentDate={august}
      events={[event(), ...crowded]}
      capabilities={capabilities}
      onEventClick={onEventClick}
      onCreateDraft={onCreate}
    />);
    fireEvent.click(screen.getByRole("button", { name: /Standup/ }));
    expect(onEventClick).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("month-overflow"));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("does not create when the calendar is read-only for create", () => {
    const onCreate = vi.fn();
    render(<MonthView
      currentDate={august}
      events={[]}
      capabilities={{ ...capabilities, events: { create: "unsupported", update: "remote", delete: "remote" } }}
      onEventClick={vi.fn()}
      onCreateDraft={onCreate}
    />);
    fireEvent.click(screen.getByTestId("month-cell-2026-08-27"));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
