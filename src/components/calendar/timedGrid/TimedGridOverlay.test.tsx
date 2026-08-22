import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbCalendarEvent } from "@/services/db/calendarEvents";
import type { CalendarProviderCapabilities } from "@/services/calendar/domain";
import { WEEK_HOUR_HEIGHT_PX } from "./constants";
import { TimedGridOverlay } from "./TimedGridOverlay";

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
    start_time: localUnix(2027, 1, 15, 10), end_time: localUnix(2027, 1, 15, 11),
    is_all_day: 0, status: "confirmed", organizer_email: null, attendees_json: null,
    html_link: null, updated_at: 1, calendar_id: "cal-1", remote_event_id: "/cal/plain.ics",
    etag: '"v1"', ical_data: null, uid: "plain-1", time_kind: "timed-zoned",
    tzid: "UTC", wall_start: "2027-01-15T10:00:00", wall_end: "2027-01-15T11:00:00",
    end_date_exclusive: null, series_uid: null, occurrence_key: null,
    is_recurrence_master: 0, transp: null, sequence: 0, origin: "remote",
    projection_key: null, projection_status: null, ...overrides,
  };
}

function mockOverlayRect(width: number) {
  const overlay = screen.getByTestId("timed-grid-overlay");
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, bottom: 1152, right: width, width, height: 1152,
    toJSON() { return {}; },
  });
  return overlay;
}

function drag(target: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(target, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(target, { pointerId: 1, clientX: to.x, clientY: to.y });
}

describe("TimedGridOverlay", () => {
  const day = new Date(2027, 0, 15);
  const nextDay = new Date(2027, 0, 16);

  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  it("opens details on click and ignores a tiny pointer wobble", () => {
    const onEventClick = vi.fn();
    const onCommit = vi.fn();
    render(<TimedGridOverlay
      days={[day]}
      hourHeightPx={WEEK_HOUR_HEIGHT_PX}
      events={[event()]}
      capabilities={capabilities}
      pendingEventIds={new Set()}
      locale="ru"
      onEventClick={onEventClick}
      onGestureCommit={onCommit}
    />);
    mockOverlayRect(400);
    const button = screen.getByRole("button", { name: /Standup/ });
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 20, clientY: 480 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 23, clientY: 483 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 23, clientY: 483 });
    fireEvent.click(button, { clientX: 23, clientY: 483 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onEventClick).toHaveBeenCalledTimes(1);
  });

  it("previews a same-day move and commits once on drop", () => {
    const onCommit = vi.fn();
    render(<TimedGridOverlay
      days={[day]}
      hourHeightPx={WEEK_HOUR_HEIGHT_PX}
      events={[event()]}
      capabilities={capabilities}
      pendingEventIds={new Set()}
      locale="ru"
      onEventClick={vi.fn()}
      onGestureCommit={onCommit}
    />);
    mockOverlayRect(400);
    const button = screen.getByRole("button", { name: /Standup/ });
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 20, clientY: 480 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 20, clientY: 552 });
    expect(screen.getByTestId("timed-drag-preview")).toHaveTextContent("11:30");
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 20, clientY: 552 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]![1]).toEqual({
      mode: "move",
      deltaStartMinutes: 90,
      deltaEndMinutes: 90,
    });
  });

  it("moves across a week column while preserving duration", () => {
    const onCommit = vi.fn();
    render(<TimedGridOverlay
      days={[day, nextDay]}
      hourHeightPx={WEEK_HOUR_HEIGHT_PX}
      events={[event()]}
      capabilities={capabilities}
      pendingEventIds={new Set()}
      locale="ru"
      onEventClick={vi.fn()}
      onGestureCommit={onCommit}
    />);
    mockOverlayRect(800);
    drag(screen.getByRole("button", { name: /Standup/ }), { x: 50, y: 480 }, { x: 500, y: 480 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]![1]).toEqual({
      mode: "move",
      deltaStartMinutes: 24 * 60,
      deltaEndMinutes: 24 * 60,
    });
  });

  it("resizes the bottom edge", () => {
    const onCommit = vi.fn();
    render(<TimedGridOverlay
      days={[day]}
      hourHeightPx={WEEK_HOUR_HEIGHT_PX}
      events={[event()]}
      capabilities={capabilities}
      pendingEventIds={new Set()}
      locale="ru"
      onEventClick={vi.fn()}
      onGestureCommit={onCommit}
    />);
    mockOverlayRect(400);
    drag(screen.getByTestId("timed-resize-end-event-1"), { x: 20, y: 528 }, { x: 20, y: 552 });
    expect(onCommit.mock.calls[0]![1]).toEqual({
      mode: "resize-end",
      deltaStartMinutes: 0,
      deltaEndMinutes: 30,
    });
  });

  it("resizes the top edge", () => {
    const onCommit = vi.fn();
    render(<TimedGridOverlay
      days={[day]}
      hourHeightPx={WEEK_HOUR_HEIGHT_PX}
      events={[event()]}
      capabilities={capabilities}
      pendingEventIds={new Set()}
      locale="ru"
      onEventClick={vi.fn()}
      onGestureCommit={onCommit}
    />);
    mockOverlayRect(400);
    drag(screen.getByTestId("timed-resize-start-event-1"), { x: 20, y: 480 }, { x: 20, y: 504 });
    expect(onCommit.mock.calls[0]![1]).toEqual({
      mode: "resize-start",
      deltaStartMinutes: 30,
      deltaEndMinutes: 0,
    });
  });

  it("does not expose drag or resize on a read-only event", () => {
    const onCommit = vi.fn();
    render(<TimedGridOverlay
      days={[day]}
      hourHeightPx={WEEK_HOUR_HEIGHT_PX}
      events={[event()]}
      capabilities={{ ...capabilities, events: { create: "remote", update: "unsupported", delete: "remote" } }}
      pendingEventIds={new Set()}
      locale="ru"
      onEventClick={vi.fn()}
      onGestureCommit={onCommit}
    />);
    mockOverlayRect(400);
    expect(screen.getByTestId("timed-event-event-1")).toHaveAttribute("data-interactive", "false");
    expect(screen.queryByTestId("timed-resize-end-event-1")).not.toBeInTheDocument();
    drag(screen.getByRole("button", { name: /Standup/ }), { x: 20, y: 480 }, { x: 20, y: 552 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not start a second gesture while the event is pending", () => {
    const onCommit = vi.fn();
    render(<TimedGridOverlay
      days={[day]}
      hourHeightPx={WEEK_HOUR_HEIGHT_PX}
      events={[event()]}
      capabilities={capabilities}
      pendingEventIds={new Set(["event-1"])}
      locale="ru"
      onEventClick={vi.fn()}
      onGestureCommit={onCommit}
    />);
    mockOverlayRect(400);
    expect(screen.getByTestId("timed-event-event-1")).toHaveAttribute("data-interactive", "false");
    drag(screen.getByRole("button", { name: /Standup/ }), { x: 20, y: 480 }, { x: 20, y: 552 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("converts a timed move into all-day when dropped on the all-day row", () => {
    const onCommit = vi.fn();
    const onConvert = vi.fn();
    render(
      <>
        <div
          data-allday-drop="2027-01-15"
          data-calendar-date="2027-01-15"
          data-testid="allday-drop-2027-01-15"
        />
        <TimedGridOverlay
          days={[day]}
          hourHeightPx={WEEK_HOUR_HEIGHT_PX}
          events={[event()]}
          capabilities={capabilities}
          pendingEventIds={new Set()}
          locale="ru"
          onEventClick={vi.fn()}
          onGestureCommit={onCommit}
          onConvertToAllDay={onConvert}
        />
      </>,
    );
    mockOverlayRect(400);
    const zone = screen.getByTestId("allday-drop-2027-01-15");
    vi.spyOn(zone, "getBoundingClientRect").mockReturnValue({
      x: 0, y: -40, top: -40, left: 0, bottom: 0, right: 400, width: 400, height: 40,
      toJSON() { return {}; },
    });
    const button = screen.getByRole("button", { name: /Standup/ });
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 20, clientY: 480 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 20, clientY: -20 });
    expect(screen.getByTestId("timed-convert-preview")).toHaveTextContent("Весь день");
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 20, clientY: -20 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onConvert).toHaveBeenCalledTimes(1);
    expect(onConvert.mock.calls[0]![1]).toEqual({ type: "to-all-day", startDate: "2027-01-15" });
  });

  it("does not convert when a resize handle is dragged over the all-day row", () => {
    const onCommit = vi.fn();
    const onConvert = vi.fn();
    render(
      <>
        <div data-allday-drop="2027-01-15" data-calendar-date="2027-01-15" data-testid="allday-drop-2027-01-15" />
        <TimedGridOverlay
          days={[day]}
          hourHeightPx={WEEK_HOUR_HEIGHT_PX}
          events={[event()]}
          capabilities={capabilities}
          pendingEventIds={new Set()}
          locale="ru"
          onEventClick={vi.fn()}
          onGestureCommit={onCommit}
          onConvertToAllDay={onConvert}
        />
      </>,
    );
    mockOverlayRect(400);
    vi.spyOn(screen.getByTestId("allday-drop-2027-01-15"), "getBoundingClientRect").mockReturnValue({
      x: 0, y: -40, top: -40, left: 0, bottom: 0, right: 400, width: 400, height: 40,
      toJSON() { return {}; },
    });
    drag(screen.getByTestId("timed-resize-end-event-1"), { x: 20, y: 528 }, { x: 20, y: -20 });
    expect(onConvert).not.toHaveBeenCalled();
  });
});
