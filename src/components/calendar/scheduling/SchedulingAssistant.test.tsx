import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { participantRefFromEmail } from "@/services/calendar/domain";
import { availability, busy, tentative } from "@/services/calendar/scheduling/testFixtures";
import type { CandidateSlot, GroupAvailabilitySegment, GroupSchedulingResult } from "@/services/calendar/scheduling";
import { SchedulingAssistant } from "./SchedulingAssistant";

const DAY = Date.UTC(2026, 2, 16) / 1000;
const TZ = "UTC";
const SELF = participantRefFromEmail("self@example.test", "Георгий");
const IVAN = participantRefFromEmail("ivan@example.test", "Иван Петров");
const ANNA = participantRefFromEmail("anna@example.test", "Анна");
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

function indexes(overrides: Partial<GroupAvailabilitySegment> = {}): GroupAvailabilitySegment {
  return {
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
    ...overrides,
  };
}

function slot(overrides: Partial<CandidateSlot> & Pick<CandidateSlot, "start" | "end">): CandidateSlot {
  return {
    classification: "confirmed",
    requiredConflicts: [],
    optionalConflicts: [],
    unknownParticipants: [],
    tentativeParticipants: [],
    outsideWorkingHoursParticipants: [],
    score: SCORE,
    ...overrides,
  };
}

function result(overrides: Partial<GroupSchedulingResult> = {}): GroupSchedulingResult {
  return {
    range: RANGE,
    timeZone: TZ,
    durationSeconds: 1800,
    granularitySeconds: 1800,
    participants: [
      { index: 0, participant: SELF, role: "required", reliability: "known", identityKey: "email:self@example.test" },
    ],
    availability: [availability(SELF, "known", [], RANGE)],
    segments: [indexes()],
    candidates: [slot({ start: DAY + 14.5 * 3600, end: DAY + 15 * 3600 })],
    suggestions: [slot({ start: DAY + 14.5 * 3600, end: DAY + 15 * 3600 })],
    workingHoursApplied: false,
    workingHoursPolicy: null,
    ...overrides,
  };
}

function renderAssistant(
  planMeeting: (request: unknown) => Promise<GroupSchedulingResult>,
  props: Partial<ComponentProps<typeof SchedulingAssistant>> = {},
) {
  return render(
    <SchedulingAssistant
      timeZone={TZ}
      startTime="2026-03-16T10:00"
      endTime="2026-03-16T10:30"
      participants={[{ participant: SELF, role: "required", isSelf: true }]}
      onSelectRange={vi.fn()}
      planMeeting={planMeeting as never}
      debounceMs={0}
      nowUnix={DAY + 9 * 3600}
      {...props}
    />,
  );
}

describe("SchedulingAssistant", () => {
  it("shows empty state when there are no participants", () => {
    render(
      <SchedulingAssistant
        timeZone={TZ}
        startTime="2026-03-16T10:00"
        endTime="2026-03-16T10:30"
        participants={[]}
        onSelectRange={vi.fn()}
        planMeeting={vi.fn()}
        debounceMs={0}
      />,
    );
    expect(screen.getByTestId("scheduling-empty")).toHaveTextContent(
      "Добавьте участников, чтобы посмотреть общее свободное время",
    );
  });

  it("shows loading until planMeeting resolves", async () => {
    let resolve!: (value: GroupSchedulingResult) => void;
    const pending = new Promise<GroupSchedulingResult>((next) => { resolve = next; });
    renderAssistant(() => pending);
    expect(await screen.findByTestId("scheduling-loading")).toBeInTheDocument();
    resolve(result());
    await waitFor(() => expect(screen.queryByTestId("scheduling-loading")).not.toBeInTheDocument());
  });

  it("renders self busy intervals from the engine result", async () => {
    renderAssistant(async () => result({
      availability: [availability(SELF, "known", [busy(DAY + 11 * 3600, DAY + 12 * 3600)], RANGE)],
    }));
    expect(await screen.findByTestId("scheduling-timeline-header")).toBeInTheDocument();
    expect(screen.getByText("Вы")).toBeInTheDocument();
    expect(screen.getByText("Время: UTC")).toBeInTheDocument();
    expect(await screen.findByTitle("Занят")).toHaveAttribute("data-busy-type", "busy");
  });

  it("shows remote unsupported as unknown, not free", async () => {
    renderAssistant(async () => result({
      participants: [
        { index: 0, participant: SELF, role: "required", reliability: "known", identityKey: "email:self@example.test" },
        { index: 1, participant: ANNA, role: "required", reliability: "unsupported", identityKey: "email:anna@example.test" },
      ],
      availability: [
        availability(SELF, "known", [], RANGE),
        availability(ANNA, "unsupported", [], RANGE),
      ],
      segments: [indexes({ requiredUnknown: [1], classification: "unknown" })],
    }), {
      participants: [
        { participant: SELF, role: "required", isSelf: true },
        { participant: ANNA, role: "required" },
      ],
    });
    expect(await screen.findByText("Занятость недоступна через подключённый календарь")).toBeInTheDocument();
    expect(screen.getByTestId("reliability-unsupported")).toHaveClass("text-warning");
    expect(screen.queryByTestId("reliability-error")).not.toBeInTheDocument();
    const unknownRows = screen.getAllByTestId("scheduling-timeline").filter((node) => node.getAttribute("data-unknown") === "true");
    expect(unknownRows.length).toBeGreaterThan(0);
    expect(screen.getByTestId("group-segment")).toHaveAttribute("data-classification", "unknown");
    expect(screen.queryByText("Свободно")).not.toBeInTheDocument();
  });

  it("marks the group row blocked when a required participant is busy", async () => {
    renderAssistant(async () => result({
      participants: [
        { index: 0, participant: SELF, role: "required", reliability: "known", identityKey: "email:self@example.test" },
        { index: 1, participant: IVAN, role: "required", reliability: "known", identityKey: "email:ivan@example.test" },
      ],
      availability: [
        availability(SELF, "known", [], RANGE),
        availability(IVAN, "known", [busy(DAY + 10 * 3600, DAY + 11 * 3600)], RANGE),
      ],
      segments: [indexes({ requiredBusy: [1], requiredFree: [0], classification: "blocked" })],
    }), {
      participants: [
        { participant: SELF, role: "required", isSelf: true },
        { participant: IVAN, role: "required" },
      ],
    });
    expect(await screen.findByTestId("group-segment")).toHaveAttribute("data-classification", "blocked");
    expect(screen.getAllByTestId("scheduling-role")[0]).toHaveTextContent("Обязательный");
  });

  it("keeps a group slot allowable when only an optional participant is busy", async () => {
    renderAssistant(async () => result({
      participants: [
        { index: 0, participant: SELF, role: "required", reliability: "known", identityKey: "email:self@example.test" },
        { index: 1, participant: ANNA, role: "optional", reliability: "known", identityKey: "email:anna@example.test" },
      ],
      availability: [
        availability(SELF, "known", [], RANGE),
        availability(ANNA, "known", [busy(DAY + 10 * 3600, DAY + 11 * 3600)], RANGE),
      ],
      segments: [indexes({ optionalBusy: [1], classification: "confirmed" })],
      suggestions: [slot({
        start: DAY + 14.5 * 3600,
        end: DAY + 15 * 3600,
        optionalConflicts: [{ participantIndex: 1, reason: "busy" }],
      })],
    }), {
      participants: [
        { participant: SELF, role: "required", isSelf: true },
        { participant: ANNA, role: "optional" },
      ],
    });
    expect(await screen.findByTestId("group-segment")).toHaveAttribute("data-classification", "confirmed");
    expect(screen.getByText("1 необязательный участник занят")).toBeInTheDocument();
    expect(screen.getByText("Необязательный")).toBeInTheDocument();
  });

  it("renders tentative distinctly from hard busy", async () => {
    renderAssistant(async () => result({
      availability: [availability(SELF, "known", [tentative(DAY + 11 * 3600, DAY + 12 * 3600)], RANGE)],
      segments: [indexes({ requiredTentative: [0], classification: "possible" })],
    }));
    const block = await screen.findByTitle("Под вопросом");
    expect(block).toHaveAttribute("data-busy-type", "tentative");
    expect(screen.getByTestId("group-segment")).toHaveAttribute("data-classification", "possible");
  });

  it("does not leak a foreign event title", async () => {
    renderAssistant(async () => result({
      availability: [availability(SELF, "known", [
        { start: DAY + 11 * 3600, end: DAY + 12 * 3600, busyType: "busy", title: "Secret board meeting" } as never,
      ], RANGE)],
    }));
    await screen.findByTitle("Занят");
    expect(screen.queryByText("Secret board meeting")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Secret board meeting")).not.toBeInTheDocument();
  });

  it("applies a suggested slot to the event editor range", async () => {
    const onSelectRange = vi.fn();
    renderAssistant(async () => result(), { onSelectRange });
    fireEvent.click(await screen.findByTestId("scheduling-suggestion"));
    expect(onSelectRange).toHaveBeenCalledWith("2026-03-16T14:30", "2026-03-16T15:00");
  });

  it("updates the timeline selection when date/time inputs change", async () => {
    const planMeeting = vi.fn(async () => result());
    const view = renderAssistant(planMeeting);
    await waitFor(() => expect(screen.getAllByTestId("scheduling-selection").length).toBeGreaterThan(0));
    const first = screen.getAllByTestId("scheduling-selection")[0]!;
    expect(first).toHaveAttribute("data-start", String(DAY + 10 * 3600));
    view.rerender(
      <SchedulingAssistant
        timeZone={TZ}
        startTime="2026-03-16T11:00"
        endTime="2026-03-16T11:30"
        participants={[{ participant: SELF, role: "required", isSelf: true }]}
        onSelectRange={vi.fn()}
        planMeeting={planMeeting}
        debounceMs={0}
        nowUnix={DAY + 9 * 3600}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByTestId("scheduling-selection")[0]).toHaveAttribute("data-start", String(DAY + 11 * 3600));
    });
  });

  it("re-runs planMeeting when the participant set changes", async () => {
    const planMeeting = vi.fn(async () => result());
    const view = renderAssistant(planMeeting);
    await waitFor(() => expect(planMeeting).toHaveBeenCalledTimes(1));
    view.rerender(
      <SchedulingAssistant
        timeZone={TZ}
        startTime="2026-03-16T10:00"
        endTime="2026-03-16T10:30"
        participants={[
          { participant: SELF, role: "required", isSelf: true },
          { participant: IVAN, role: "required" },
        ]}
        onSelectRange={vi.fn()}
        planMeeting={planMeeting}
        debounceMs={0}
        nowUnix={DAY + 9 * 3600}
      />,
    );
    await waitFor(() => expect(planMeeting).toHaveBeenCalledTimes(2));
    const second = planMeeting.mock.calls[1]![0] as { requiredParticipants: unknown[] };
    expect(second.requiredParticipants).toHaveLength(2);
  });

  it("shows permission-denied as a specific caption", async () => {
    renderAssistant(async () => result({
      participants: [
        { index: 0, participant: IVAN, role: "required", reliability: "permission-denied", identityKey: "email:ivan@example.test" },
      ],
      availability: [availability(IVAN, "permission-denied", [], RANGE)],
    }), {
      participants: [{ participant: IVAN, role: "required" }],
    });
    expect(await screen.findByText("Нет доступа к занятости")).toBeInTheDocument();
  });

  it("shows engine working-hours state separately from busy", async () => {
    renderAssistant(async () => result({
      workingHoursApplied: true,
      workingHoursPolicy: "prefer",
      candidates: [slot({
        start: DAY + 20 * 3600,
        end: DAY + 20.5 * 3600,
        classification: "blocked",
        outsideWorkingHoursParticipants: [0],
      })],
      suggestions: [slot({
        start: DAY + 14.5 * 3600,
        end: DAY + 15 * 3600,
        outsideWorkingHoursParticipants: [0],
      })],
    }));
    expect(await screen.findByText(/Учтены рабочие часы/)).toBeInTheDocument();
    expect(screen.getByText("вне рабочего времени")).toBeInTheDocument();
    expect(screen.getByTestId("scheduling-outside-hours")).toBeInTheDocument();
  });
});
