import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { participantRefFromEmail, type CalendarProviderCapabilities } from "@/services/calendar/domain";
import { availability } from "@/services/calendar/scheduling/testFixtures";
import type { CandidateSlot, GroupSchedulingResult } from "@/services/calendar/scheduling";
import { EventCreateModal } from "./EventCreateModal";

const DAY = Date.UTC(2026, 2, 16) / 1000;
const SELF = participantRefFromEmail("self@example.test", "Георгий");
const RANGE = { start: DAY, end: DAY + 86400 };
const SCORE: CandidateSlot["score"] = {
  total: 90,
  components: {
    classification: 80,
    optionalFree: 10,
    optionalTentative: 0,
    optionalUnknown: 0,
    optionalBusy: 0,
    workingHours: 0,
    earliness: 0,
  },
};
const GOOGLE_CAPABILITIES = {
  reminders: { read: "full", write: "full", multiple: true, methods: ["notification", "email"], defaults: "inherit", maxCount: 5 },
} as CalendarProviderCapabilities;

function result(): GroupSchedulingResult {
  const suggestion: CandidateSlot = {
    start: DAY + 14.5 * 3600,
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
    range: RANGE,
    timeZone: "UTC",
    durationSeconds: 1800,
    granularitySeconds: 1800,
    participants: [
      { index: 0, participant: SELF, role: "required", reliability: "known", identityKey: "email:self@example.test" },
    ],
    availability: [availability(SELF, "known", [], RANGE)],
    segments: [{
      start: RANGE.start,
      end: RANGE.end,
      requiredFree: [0],
      requiredBusy: [],
      requiredTentative: [],
      requiredUnknown: [],
      optionalFree: [],
      optionalBusy: [],
      optionalTentative: [],
      optionalUnknown: [],
      classification: "confirmed",
    }],
    candidates: [suggestion],
    suggestions: [suggestion],
    workingHoursApplied: false,
    workingHoursPolicy: null,
  };
}

describe("EventCreateModal scheduling assistant", () => {
  it("shows empty assistant copy when there is no current user and no attendees", () => {
    render(
      <EventCreateModal
        timeZone="UTC"
        initialValues={{ startTime: "2026-03-16T10:00", endTime: "2026-03-16T10:30" }}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        planMeeting={vi.fn()}
        debounceMs={0}
      />,
    );
    expect(screen.getByTestId("scheduling-empty")).toBeInTheDocument();
  });

  it("writes a suggested slot into start/end without saving", async () => {
    const onCreate = vi.fn();
    render(
      <EventCreateModal
        timeZone="UTC"
        selfEmail="self@example.test"
        selfDisplayName="Георгий"
        initialValues={{ startTime: "2026-03-16T10:00", endTime: "2026-03-16T10:30" }}
        onClose={vi.fn()}
        onCreate={onCreate}
        planMeeting={async () => result()}
        debounceMs={0}
      />,
    );
    fireEvent.click(await screen.findByTestId("scheduling-suggestion"));
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("2026-03-16T14:30");
    expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("2026-03-16T15:00");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("re-queries the engine when attendees change", async () => {
    const planMeeting = vi.fn(async () => result());
    render(
      <EventCreateModal
        timeZone="UTC"
        selfEmail="self@example.test"
        initialValues={{ startTime: "2026-03-16T10:00", endTime: "2026-03-16T10:30" }}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        planMeeting={planMeeting}
        debounceMs={0}
      />,
    );
    await waitFor(() => expect(planMeeting).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Participants"), { target: { value: "ivan@example.test" } });
    await waitFor(() => expect(planMeeting).toHaveBeenCalledTimes(2));
    const request = planMeeting.mock.calls[1]![0] as { requiredParticipants: Array<{ normalizedEmail: string | null }> };
    expect(request.requiredParticipants.map((item) => item.normalizedEmail)).toEqual([
      "self@example.test",
      "ivan@example.test",
    ]);
  });

  it("hydrates an all-day grid draft and does not save on Cancel", () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    render(
      <EventCreateModal
        timeZone="UTC"
        initialValues={{
          startTime: "2026-08-27",
          endTime: "2026-08-27",
          allDay: true,
          time: { kind: "all-day", startDate: "2026-08-27", endDateExclusive: "2026-08-28" },
        }}
        onClose={onClose}
        onCreate={onCreate}
      />,
    );
    expect((screen.getByTestId("event-all-day") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("2026-08-27");
    expect(screen.queryByTestId("scheduling-empty")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("rebuilds timed-zoned time from form fields on Create", async () => {
    const onCreate = vi.fn();
    render(
      <EventCreateModal
        timeZone="Europe/Moscow"
        initialValues={{ startTime: "2026-08-27T10:30", endTime: "2026-08-27T11:30" }}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Grid draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]![0]).toMatchObject({
      summary: "Grid draft",
      allDay: false,
      startTime: "2026-08-27T10:30",
      endTime: "2026-08-27T11:30",
      time: { kind: "timed-zoned" },
    });
  });

  it("uses the same provider-default reminder policy for a hydrated grid draft", async () => {
    const onCreate = vi.fn();
    render(
      <EventCreateModal
        capabilities={GOOGLE_CAPABILITIES}
        timeZone="UTC"
        initialValues={{ startTime: "2026-08-27", endTime: "2026-08-27", allDay: true }}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );
    expect(screen.getByLabelText("Политика напоминаний")).toHaveValue("inherit");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Grid with default" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ reminders: { kind: "inherit" } })));
  });
});
