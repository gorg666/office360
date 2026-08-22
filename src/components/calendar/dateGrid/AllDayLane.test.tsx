import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { CalendarProviderCapabilities } from "@/services/calendar/domain";
import { calendarDateFromLocalDate, calendarDateToUnixSeconds } from "@/services/calendar/domain";
import { WEEK_HOUR_HEIGHT_PX } from "../timedGrid/constants";
import { AllDayLane } from "./AllDayLane";

const capabilities = {
  events: { create: "remote", update: "remote", delete: "remote" },
  recurrence: { updateScopes: ["single", "series"], deleteScopes: ["single", "series"] },
} as CalendarProviderCapabilities;

const days = Array.from({ length: 7 }, (_, i) => new Date(2026, 7, 16 + i));

function allDayEvent(overrides: Partial<DbCalendarEvent> = {}): DbCalendarEvent {
  return {
    id: "event-1", account_id: "account-1", google_event_id: "/cal/plain.ics",
    summary: "Holiday", description: null, location: null,
    start_time: calendarDateToUnixSeconds("2026-08-16"),
    end_time: calendarDateToUnixSeconds("2026-08-17"),
    is_all_day: 1, status: "confirmed", organizer_email: null, attendees_json: null,
    html_link: null, updated_at: 1, calendar_id: "cal-1", remote_event_id: "/cal/plain.ics",
    etag: '"v1"', ical_data: null, uid: "plain-1", time_kind: "all-day",
    tzid: null, wall_start: null, wall_end: null, end_date_exclusive: "2026-08-17",
    series_uid: null, occurrence_key: null, is_recurrence_master: 0, transp: null,
    sequence: 0, origin: "remote", projection_key: null, projection_status: null, ...overrides,
  };
}

function layoutDrops() {
  days.forEach((day, index) => {
    const date = calendarDateFromLocalDate(day);
    const cell = screen.getByTestId(`allday-drop-${date}`);
    vi.spyOn(cell, "getBoundingClientRect").mockReturnValue({
      x: 60 + index * 100, y: 0, left: 60 + index * 100, top: 0,
      right: 160 + index * 100, bottom: 40, width: 100, height: 40,
      toJSON() { return {}; },
    });
  });
}

function dropPoint(date: string) {
  const rect = screen.getByTestId(`allday-drop-${date}`).getBoundingClientRect();
  return { x: rect.left + 10, y: rect.top + 10 };
}

describe("AllDayLane", () => {
  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  it("opens details on click and ignores a tiny pointer wobble", () => {
    const onEventClick = vi.fn();
    const onDateCommit = vi.fn();
    const event = allDayEvent();
    render(<AllDayLane
      days={days}
      capabilities={capabilities}
      pendingEventIds={new Set()}
      locale="ru"
      hourHeightPx={WEEK_HOUR_HEIGHT_PX}
      onEventClick={onEventClick}
      onDateCommit={onDateCommit}
      eventsByDay={new Map([["2026-08-16", [event]]])}
    />);
    layoutDrops();
    const button = screen.getByTestId("allday-event-event-1");
    const from = dropPoint("2026-08-16");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: from.x + 3, clientY: from.y + 2 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: from.x + 3, clientY: from.y + 2 });
    fireEvent.click(button);
    expect(onDateCommit).not.toHaveBeenCalled();
    expect(onEventClick).toHaveBeenCalledTimes(1);
  });

  it("moves an all-day event to another all-day day and keeps date semantics", () => {
    const onDateCommit = vi.fn();
    const event = allDayEvent();
    render(<AllDayLane
      days={days}
      capabilities={capabilities}
      pendingEventIds={new Set()}
      locale="ru"
      hourHeightPx={WEEK_HOUR_HEIGHT_PX}
      onEventClick={vi.fn()}
      onDateCommit={onDateCommit}
      eventsByDay={new Map([["2026-08-16", [event]]])}
    />);
    layoutDrops();
    const button = screen.getByTestId("allday-event-event-1");
    const from = dropPoint("2026-08-16");
    const to = dropPoint("2026-08-18");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: to.x, clientY: to.y });
    expect(screen.getByTestId("allday-drag-preview")).toHaveTextContent("Весь день");
    fireEvent.pointerUp(button, { pointerId: 1, clientX: to.x, clientY: to.y });
    expect(onDateCommit).toHaveBeenCalledTimes(1);
    expect(onDateCommit.mock.calls[0]![1]).toEqual({ type: "shift", deltaDays: 2 });
  });

  it("converts all-day to timed with the shared snap and default duration", () => {
    const onDateCommit = vi.fn();
    const event = allDayEvent();
    render(
      <>
        <AllDayLane
          days={days}
          capabilities={capabilities}
          pendingEventIds={new Set()}
          locale="ru"
          hourHeightPx={WEEK_HOUR_HEIGHT_PX}
          onEventClick={vi.fn()}
          onDateCommit={onDateCommit}
          eventsByDay={new Map([["2026-08-16", [event]]])}
        />
        <div data-testid="timed-grid-overlay" />
      </>,
    );
    layoutDrops();
    const overlay = screen.getByTestId("timed-grid-overlay");
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      x: 60, y: 40, top: 40, left: 60, bottom: 1192, right: 760, width: 700, height: 1152,
      toJSON() { return {}; },
    });
    const button = screen.getByTestId("allday-event-event-1");
    const from = dropPoint("2026-08-16");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 80, clientY: 40 + 10 * WEEK_HOUR_HEIGHT_PX });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 80, clientY: 40 + 10 * WEEK_HOUR_HEIGHT_PX });
    expect(onDateCommit).toHaveBeenCalledTimes(1);
    expect(onDateCommit.mock.calls[0]![1]).toEqual({
      type: "to-timed",
      startDate: "2026-08-16",
      startMinutesFromMidnight: 10 * 60,
    });
  });

  it("does not drag a read-only all-day event", () => {
    const onDateCommit = vi.fn();
    const event = allDayEvent();
    render(<AllDayLane
      days={days}
      capabilities={{ ...capabilities, events: { create: "remote", update: "unsupported", delete: "remote" } }}
      pendingEventIds={new Set()}
      locale="ru"
      hourHeightPx={WEEK_HOUR_HEIGHT_PX}
      onEventClick={vi.fn()}
      onDateCommit={onDateCommit}
      eventsByDay={new Map([["2026-08-16", [event]]])}
    />);
    layoutDrops();
    expect(screen.getByTestId("allday-event-event-1")).toHaveAttribute("data-interactive", "false");
    const button = screen.getByTestId("allday-event-event-1");
    const from = dropPoint("2026-08-16");
    const to = dropPoint("2026-08-18");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: to.x, clientY: to.y });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: to.x, clientY: to.y });
    expect(onDateCommit).not.toHaveBeenCalled();
  });

  it("creates a single-day all-day draft from an empty cell", () => {
    const onCreate = vi.fn();
    render(<AllDayLane
      days={days}
      capabilities={capabilities}
      pendingEventIds={new Set()}
      locale="ru"
      hourHeightPx={WEEK_HOUR_HEIGHT_PX}
      onEventClick={vi.fn()}
      onDateCommit={vi.fn()}
      eventsByDay={new Map()}
      onCreateDraft={onCreate}
    />);
    fireEvent.click(screen.getByTestId("allday-drop-2026-08-19"));
    expect(onCreate).toHaveBeenCalledWith({
      kind: "all-day",
      startDate: "2026-08-19",
      endDateExclusive: "2026-08-20",
    });
  });

  it("does not create from an existing all-day event click", () => {
    const onCreate = vi.fn();
    const onEventClick = vi.fn();
    const event = allDayEvent();
    render(<AllDayLane
      days={days}
      capabilities={capabilities}
      pendingEventIds={new Set()}
      locale="ru"
      hourHeightPx={WEEK_HOUR_HEIGHT_PX}
      onEventClick={onEventClick}
      onDateCommit={vi.fn()}
      eventsByDay={new Map([["2026-08-16", [event]]])}
      onCreateDraft={onCreate}
    />);
    fireEvent.click(screen.getByTestId("allday-event-event-1"));
    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
