import {
  instantSecondsToWallDateTime,
  participantIdentityKey,
  zonedWallDateTimeToInstant,
} from "../domain";
import type { AvailabilityInterval, AvailabilityState, ParticipantAvailability } from "../freeBusy";
import { classifyRequiredStates, createStateLookup } from "./timeline";
import { fitsWithinWorkingIntervals, workingIntervalsFor } from "./workingHours";
import type {
  CandidateSlot,
  ParticipantConflict,
  SchedulingParticipant,
  SlotClassification,
  SlotScore,
  UnavailableReason,
  WorkingHoursConstraint,
} from "./types";

const MINUTES_PER_DAY = 24 * 60;

/**
 * Scoring weights. Documented and deterministic — no magic numbers and no model.
 *
 * `classification` dominates by construction: every other component is summed and then
 * clamped to ±`ADJUSTMENT_CLAMP`, which is smaller than half the 3000-point gap between
 * adjacent classifications. A `possible` slot can therefore never outrank a `confirmed` one.
 */
export const SLOT_SCORE_WEIGHTS = {
  classification: { confirmed: 10_000, possible: 6_000, unknown: 3_000, blocked: 0 },
  optionalFree: 15,
  optionalTentative: -30,
  optionalUnknown: -40,
  optionalBusy: -60,
  /** Applied per participant outside their working window under the `prefer` policy. */
  workingHours: -200,
  /** Earliness tie-break only; bounded so it can never outweigh a real factor. */
  earlinessMax: 9,
} as const;

export const ADJUSTMENT_CLAMP = 1_400;

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * Candidate starts are aligned to the wall clock of the requested zone, walking each local
 * day from local midnight in `granularitySeconds` steps. Alignment therefore survives DST:
 * a 30-minute grid stays on :00/:30 local on both sides of a transition, and 10:07 is never
 * a candidate start.
 */
export function candidateStarts(
  range: AvailabilityInterval,
  timeZone: string,
  granularitySeconds: number,
  durationSeconds: number,
): number[] {
  if (granularitySeconds <= 0 || granularitySeconds % 60 !== 0) {
    throw new Error("Slot granularity must be a positive whole number of minutes");
  }
  if (durationSeconds <= 0) throw new Error("Meeting duration must be positive");
  if (range.end - range.start < durationSeconds) return [];

  const granularityMinutes = granularitySeconds / 60;
  const first = instantSecondsToWallDateTime(range.start, timeZone);
  const dayCount = Math.ceil((range.end - range.start) / 86400) + 2;
  const starts = new Set<number>();

  for (let dayOffset = -1; dayOffset < dayCount; dayOffset += 1) {
    const base = new Date(Date.UTC(first.year, first.month - 1, first.day) + dayOffset * 86400000);
    const date = {
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate(),
    };
    for (let minute = 0; minute < MINUTES_PER_DAY; minute += granularityMinutes) {
      const instant = zonedWallDateTimeToInstant(
        { ...date, hour: Math.floor(minute / 60), minute: minute % 60, second: 0 },
        timeZone,
      );
      if (instant >= range.start && instant + durationSeconds <= range.end) starts.add(instant);
    }
  }
  return [...starts].sort((a, b) => a - b);
}

export interface CandidateSearchInput {
  participants: readonly SchedulingParticipant[];
  availability: readonly ParticipantAvailability[];
  range: AvailabilityInterval;
  durationSeconds: number;
  granularitySeconds: number;
  timeZone: string;
  workingHours?: WorkingHoursConstraint;
}

function workingIntervalsByParticipant(
  input: CandidateSearchInput,
): Map<number, AvailabilityInterval[]> {
  const map = new Map<number, AvailabilityInterval[]>();
  const constraint = input.workingHours;
  if (!constraint) return map;
  for (const participant of input.participants) {
    const hours = constraint.byParticipant?.[participantIdentityKey(participant.participant)]
      ?? constraint.default;
    // No window supplied means no constraint for this participant — never an invented default.
    if (!hours) continue;
    map.set(participant.index, workingIntervalsFor(hours, input.range));
  }
  return map;
}

export function findCandidateSlots(input: CandidateSearchInput): CandidateSlot[] {
  const lookup = createStateLookup(input.availability);
  const working = workingIntervalsByParticipant(input);
  const requirePolicy = input.workingHours?.policy === "require";
  const rangeSpan = Math.max(1, input.range.end - input.range.start);

  return candidateStarts(input.range, input.timeZone, input.granularitySeconds, input.durationSeconds)
    .map((start) => {
      const interval = { start, end: start + input.durationSeconds };
      const requiredConflicts: ParticipantConflict[] = [];
      const optionalConflicts: ParticipantConflict[] = [];
      const unknownParticipants: number[] = [];
      const tentativeParticipants: number[] = [];
      const outsideWorkingHoursParticipants: number[] = [];
      const requiredStates: AvailabilityState[] = [];
      let optionalFree = 0, optionalTentative = 0, optionalUnknown = 0, optionalBusy = 0;

      for (const participant of input.participants) {
        const state = lookup.stateFor(participant.index, interval);
        const required = participant.role === "required";
        if (required) requiredStates.push(state);

        const reasons: UnavailableReason[] = [];
        if (state === "busy") reasons.push("busy");
        if (state === "tentative") { reasons.push("tentative"); tentativeParticipants.push(participant.index); }
        if (state === "unknown") { reasons.push("unknown"); unknownParticipants.push(participant.index); }

        const windows = working.get(participant.index);
        if (windows && !fitsWithinWorkingIntervals(interval, windows)) {
          reasons.push("outside-working-hours");
          outsideWorkingHoursParticipants.push(participant.index);
        }

        for (const reason of reasons) {
          (required ? requiredConflicts : optionalConflicts).push({ participantIndex: participant.index, reason });
        }
        if (!required) {
          if (state === "free") optionalFree += 1;
          else if (state === "tentative") optionalTentative += 1;
          else if (state === "unknown") optionalUnknown += 1;
          else optionalBusy += 1;
        }
      }

      let classification: SlotClassification = classifyRequiredStates(requiredStates);
      const requiredOutside = input.participants.some((participant) =>
        participant.role === "required" && outsideWorkingHoursParticipants.includes(participant.index));
      if (requirePolicy && requiredOutside && classification !== "blocked") classification = "blocked";

      const components = {
        classification: SLOT_SCORE_WEIGHTS.classification[classification],
        optionalFree: optionalFree * SLOT_SCORE_WEIGHTS.optionalFree,
        optionalTentative: optionalTentative * SLOT_SCORE_WEIGHTS.optionalTentative,
        optionalUnknown: optionalUnknown * SLOT_SCORE_WEIGHTS.optionalUnknown,
        optionalBusy: optionalBusy * SLOT_SCORE_WEIGHTS.optionalBusy,
        workingHours: outsideWorkingHoursParticipants.length * SLOT_SCORE_WEIGHTS.workingHours,
        earliness: -Math.round(
          SLOT_SCORE_WEIGHTS.earlinessMax * ((start - input.range.start) / rangeSpan),
        ),
      };
      const adjustment = components.optionalFree + components.optionalTentative
        + components.optionalUnknown + components.optionalBusy
        + components.workingHours + components.earliness;
      const score: SlotScore = {
        total: components.classification + clamp(adjustment, ADJUSTMENT_CLAMP),
        components,
      };

      return {
        ...interval, classification, requiredConflicts, optionalConflicts,
        unknownParticipants, tentativeParticipants, outsideWorkingHoursParticipants, score,
      };
    });
}

/**
 * Top N candidates. `blocked` slots are never suggested; everything else is ordered by score
 * then by start, so the result is stable for identical input.
 */
export function suggestSlots(candidates: readonly CandidateSlot[], limit = 3): CandidateSlot[] {
  return candidates
    .filter((candidate) => candidate.classification !== "blocked")
    .slice()
    .sort((a, b) => b.score.total - a.score.total || a.start - b.start)
    .slice(0, Math.max(0, limit));
}
