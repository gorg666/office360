import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CalendarInviteCard } from "./CalendarInviteCard";
import type { DbCalendarInvitation } from "@/services/db/calendarInvitations";

function makeInvitation(overrides: Partial<DbCalendarInvitation> = {}): DbCalendarInvitation {
  return {
    id: "invite-1",
    account_id: "acc-1",
    thread_id: "thread-1",
    message_id: "msg-1",
    event_uid: "uid-1",
    recurrence_id: null,
    recurrence_key: "",
    method: "REQUEST",
    sequence: 2,
    status: "confirmed",
    summary: "Planning",
    description: null,
    location: null,
    start_time: Math.floor(new Date("2026-06-20T10:00:00Z").getTime() / 1000),
    end_time: Math.floor(new Date("2026-06-20T11:00:00Z").getTime() / 1000),
    is_all_day: 0,
    timezone_id: "Europe/Moscow",
    timezone_warning: 0,
    organizer_email: "lead@example.com",
    attendees_json: null,
    rsvp_status: "needs_action",
    rsvp_queue_status: "queued",
    queued_operation_id: "op-1",
    calendar_event_id: null,
    raw_ical: "BEGIN:VCALENDAR",
    source_hash: "body:abc",
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

describe("CalendarInviteCard", () => {
  it("renders invite details and queued RSVP state", () => {
    render(<CalendarInviteCard invitation={makeInvitation()} onRespond={vi.fn()} />);

    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(screen.getByText("Update 2")).toBeInTheDocument();
    expect(screen.getByText("Organizer: lead@example.com")).toBeInTheDocument();
    expect(screen.getByText("RSVP: Needs action")).toBeInTheDocument();
    expect(screen.getByText("Response queued for delivery.")).toBeInTheDocument();
    expect(screen.getByText("Timezone: Europe/Moscow")).toBeInTheDocument();
    expect(screen.queryByText(/Timezone needs review/i)).not.toBeInTheDocument();
  });

  it("fires RSVP action", async () => {
    const onRespond = vi.fn();
    render(<CalendarInviteCard invitation={makeInvitation()} onRespond={onRespond} />);

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));

    expect(onRespond).toHaveBeenCalledWith("invite-1", "accepted");
  });

  it("shows cancellation without RSVP buttons", () => {
    render(
      <CalendarInviteCard
        invitation={makeInvitation({ method: "CANCEL", status: "cancelled" })}
        onRespond={vi.fn()}
      />,
    );

    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
  });

  it("renders compact processed state after a response is selected", () => {
    render(
      <CalendarInviteCard
        invitation={makeInvitation({ rsvp_status: "accepted", rsvp_queue_status: "blocked" })}
        onRespond={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Accepted")).toHaveLength(1);
    expect(screen.getByText("Provider delivery unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tentative/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /decline/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Organizer: lead@example.com")).not.toBeInTheDocument();
  });

  it("expands processed invite details", () => {
    render(
      <CalendarInviteCard
        invitation={makeInvitation({
          rsvp_status: "accepted",
          rsvp_queue_status: "blocked",
          location: "Online",
          description: "Bring the notes",
        })}
        onRespond={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /details/i }));

    expect(screen.getByRole("button", { name: /hide/i })).toBeInTheDocument();
    expect(screen.getByText("Organizer: lead@example.com")).toBeInTheDocument();
    expect(screen.getByText("Location: Online")).toBeInTheDocument();
    expect(screen.getByText("Timezone: Europe/Moscow")).toBeInTheDocument();
    expect(screen.getByText("Bring the notes")).toBeInTheDocument();
    expect(screen.queryByText("RSVP: Accepted")).not.toBeInTheDocument();
    expect(screen.queryByText("Response saved locally. Provider delivery is not available yet.")).not.toBeInTheDocument();
  });

  it("shows timezone warning only when the invitation marks it risky", () => {
    render(
      <CalendarInviteCard
        invitation={makeInvitation({
          timezone_id: "Mars/Phobos",
          timezone_warning: 1,
        })}
        onRespond={vi.fn()}
      />,
    );

    expect(screen.getByText("Timezone needs review: Mars/Phobos")).toBeInTheDocument();
    expect(screen.queryByText("Timezone: Mars/Phobos")).not.toBeInTheDocument();
  });
});
