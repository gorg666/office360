import { participantRefFromEmail } from "../domain";
import { FreeBusyService, type FreeBusyPort, type ParticipantAvailability } from "../freeBusy";
import { SchedulingAssistantService } from "./schedulingAssistantService";

const required = participantRefFromEmail("required@example.com");
const optional = participantRefFromEmail("optional@example.com");
const range = { start: Date.parse("2026-08-22T10:00:00Z") / 1000, end: Date.parse("2026-08-22T12:00:00Z") / 1000 };

function availability(
  participant: typeof required,
  reliability: ParticipantAvailability["reliability"],
  busy: ParticipantAvailability["busy"] = [],
): ParticipantAvailability {
  return { participant, reliability, source: "remote-provider", busy, range, timeZone: "UTC",
    observedAt: range.start, dataAsOf: reliability === "known" ? range.start : null,
    diagnostics: reliability === "permission-denied" ? [{ code: "permission-denied", severity: "warning" }] : [] };
}

function service(entries: ParticipantAvailability[]): SchedulingAssistantService {
  const byEmail = new Map(entries.map((entry) => [entry.participant.normalizedEmail, entry]));
  const port: FreeBusyPort = {
    source: "remote-provider",
    canAnswer: () => true,
    queryAvailability: async (participants) => participants.map((participant) => byEmail.get(participant.normalizedEmail)!),
  };
  return new SchedulingAssistantService(new FreeBusyService([port]));
}

async function plan(engine: SchedulingAssistantService, optionalParticipants: typeof optional[] = []) {
  return engine.planMeeting({
    requiredParticipants: [required], optionalParticipants, range,
    durationSeconds: 30 * 60, timeZone: "UTC", options: { granularitySeconds: 30 * 60 },
  });
}

describe("Scheduling Assistant remote Free/Busy integration", () => {
  it("blocks a required remote busy interval", async () => {
    const result = await plan(service([availability(required, "known", [
      { start: range.start, end: range.start + 1800, busyType: "busy" },
    ])]));
    expect(result.candidates[0]).toMatchObject({ classification: "blocked" });
  });

  it("confirms required remote free only when reliability is known", async () => {
    const result = await plan(service([availability(required, "known")]));
    expect(result.candidates[0]).toMatchObject({ classification: "confirmed" });
  });

  it("keeps optional remote busy selectable and explains the conflict", async () => {
    const result = await plan(service([
      availability(required, "known"),
      availability(optional, "known", [{ start: range.start, end: range.start + 1800, busyType: "busy" }]),
    ]), [optional]);
    expect(result.candidates[0]?.classification).toBe("confirmed");
    expect(result.candidates[0]?.optionalConflicts).toHaveLength(1);
  });

  it("treats permission denied as unknown, never free", async () => {
    const result = await plan(service([availability(required, "permission-denied")]));
    expect(result.candidates[0]).toMatchObject({ classification: "unknown" });
  });
});
