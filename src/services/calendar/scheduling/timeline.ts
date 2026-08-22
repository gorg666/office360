import { availabilityStateForInterval } from "../freeBusy";
import type {
  AvailabilityInterval,
  AvailabilityState,
  ParticipantAvailability,
} from "../freeBusy";
import type {
  GroupAvailabilitySegment,
  SchedulingParticipant,
  SlotClassification,
} from "./types";

/**
 * Classification from the required participants alone, in descending severity:
 * a definite conflict beats missing data, which beats a soft conflict.
 *
 * Optional participants never influence this: they change ranking, not feasibility.
 */
export function classifyRequiredStates(states: readonly AvailabilityState[]): SlotClassification {
  if (states.length === 0) return "confirmed";
  if (states.includes("busy")) return "blocked";
  if (states.includes("unknown")) return "unknown";
  if (states.includes("tentative")) return "possible";
  return "confirmed";
}

export interface ParticipantStateLookup {
  stateFor(participantIndex: number, interval: AvailabilityInterval): AvailabilityState;
}

/**
 * `unknown` here covers both "reliable data, but this instant is not described" and
 * "the whole answer is unreliable" — CAL-107's accessor already refuses to call either free.
 */
export function createStateLookup(
  availability: readonly ParticipantAvailability[],
): ParticipantStateLookup {
  return {
    stateFor(participantIndex, interval) {
      const entry = availability[participantIndex];
      if (!entry) return "unknown";
      return availabilityStateForInterval(entry, interval);
    },
  };
}

/**
 * Split the range at every availability boundary so each segment has a single, stable
 * group state. Boundaries come from participant busy intervals; nothing else can change
 * the aggregate mid-segment.
 */
export function buildGroupTimeline(
  participants: readonly SchedulingParticipant[],
  availability: readonly ParticipantAvailability[],
  range: AvailabilityInterval,
): GroupAvailabilitySegment[] {
  if (range.end <= range.start) return [];
  const lookup = createStateLookup(availability);

  const boundaries = new Set<number>([range.start, range.end]);
  for (const entry of availability) {
    for (const interval of entry.busy) {
      if (interval.start > range.start && interval.start < range.end) boundaries.add(interval.start);
      if (interval.end > range.start && interval.end < range.end) boundaries.add(interval.end);
    }
  }
  const ordered = [...boundaries].sort((a, b) => a - b);

  const segments: GroupAvailabilitySegment[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const interval = { start: ordered[index]!, end: ordered[index + 1]! };
    const segment: GroupAvailabilitySegment = {
      ...interval,
      requiredFree: [], requiredBusy: [], requiredTentative: [], requiredUnknown: [],
      optionalFree: [], optionalBusy: [], optionalTentative: [], optionalUnknown: [],
      classification: "confirmed",
    };
    const requiredStates: AvailabilityState[] = [];

    for (const participant of participants) {
      const state = lookup.stateFor(participant.index, interval);
      const required = participant.role === "required";
      if (required) requiredStates.push(state);
      const bucket = required
        ? { free: segment.requiredFree, busy: segment.requiredBusy, tentative: segment.requiredTentative, unknown: segment.requiredUnknown }
        : { free: segment.optionalFree, busy: segment.optionalBusy, tentative: segment.optionalTentative, unknown: segment.optionalUnknown };
      bucket[state === "free" ? "free" : state === "busy" ? "busy" : state === "tentative" ? "tentative" : "unknown"]
        .push(participant.index);
    }

    segment.classification = classifyRequiredStates(requiredStates);
    segments.push(segment);
  }
  return segments;
}
