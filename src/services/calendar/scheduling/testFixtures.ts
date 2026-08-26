import { participantRefFromEmail, type ParticipantRef } from "../domain";
import type { AvailabilityReliability, BusyInterval, ParticipantAvailability } from "../freeBusy";
import { flattenSchedulingParticipants } from "./schedulingAssistantService";
import type { SchedulingParticipant } from "./types";

/** Test-only helpers. Not imported by any production module. */

export const HOUR = 3600;

export function ref(name: string): ParticipantRef {
  return participantRefFromEmail(`${name}@example.test`);
}

export function availability(
  participant: ParticipantRef,
  reliability: AvailabilityReliability,
  busy: BusyInterval[],
  range: { start: number; end: number },
): ParticipantAvailability {
  return {
    participant,
    reliability,
    source: reliability === "unsupported" ? "none" : "local-cache",
    busy,
    range: { ...range },
    timeZone: "UTC",
    observedAt: range.start,
    dataAsOf: reliability === "known" ? range.start : null,
    diagnostics: [],
  };
}

export function busy(start: number, end: number): BusyInterval {
  return { start, end, busyType: "busy" };
}

export function tentative(start: number, end: number): BusyInterval {
  return { start, end, busyType: "tentative" };
}

export function participantsOf(
  required: readonly ParticipantRef[],
  optional: readonly ParticipantRef[] = [],
): SchedulingParticipant[] {
  return flattenSchedulingParticipants(required, optional);
}
