import type { ParticipantRef } from "../domain";
import type {
  AvailabilityInterval,
  AvailabilityReliability,
  ParticipantAvailability,
} from "../freeBusy";

export type ParticipantRole = "required" | "optional";

/**
 * Why a participant cannot take a slot. `busy` and `outside-working-hours` are different
 * reasons and must never be merged: one is a meeting, the other is a policy window.
 */
export type UnavailableReason = "busy" | "tentative" | "outside-working-hours" | "unknown";

/**
 * Slot quality, in descending severity: `blocked` > `unknown` > `possible` > `confirmed`.
 * A slot can only be `confirmed` when every required participant is provably free.
 */
export type SlotClassification = "confirmed" | "possible" | "unknown" | "blocked";

/**
 * Provider-neutral working-hours window. Overnight windows (`endMinute <= startMinute`) are
 * rejected rather than silently ignored — see CALENDAR_SCHEDULING_ASSISTANT_MODEL.md.
 */
export interface WorkingHours {
  /** IANA zone. Each participant may have their own. */
  timeZone: string;
  /** 0 = Sunday .. 6 = Saturday, matching the existing Calendar day convention. */
  workingDays: readonly number[];
  /** Minutes from local midnight, inclusive. */
  startMinute: number;
  /** Minutes from local midnight, exclusive. */
  endMinute: number;
}

export type WorkingHoursPolicy = "prefer" | "require";

export interface WorkingHoursConstraint {
  /**
   * `prefer` keeps the slot and penalises it; `require` blocks it. There is no implicit
   * default working day: when no window is supplied the constraint is simply not applied.
   */
  policy: WorkingHoursPolicy;
  default?: WorkingHours;
  /** Keyed by `participantIdentityKey(participant)`. */
  byParticipant?: Readonly<Record<string, WorkingHours>>;
}

export interface SchedulingOptions {
  /** Candidate step in seconds. Any positive value is allowed; 15/30/60 min are typical. */
  granularitySeconds?: number;
  workingHours?: WorkingHoursConstraint;
  /** Forwarded to `FreeBusyService`. */
  stalenessThresholdSeconds?: number | null;
  signal?: AbortSignal;
}

/** Provider-neutral group request. Carries identities and a window, never a CalendarEvent. */
export interface GroupSchedulingRequest {
  requiredParticipants: readonly ParticipantRef[];
  optionalParticipants?: readonly ParticipantRef[];
  range: AvailabilityInterval;
  /** Meeting length in seconds. Candidates must fit entirely inside the range. */
  durationSeconds: number;
  /** IANA zone the assistant is presenting in. */
  timeZone: string;
  options?: SchedulingOptions;
}

/** Flattened participant list; segments and slots reference participants by `index`. */
export interface SchedulingParticipant {
  index: number;
  participant: ParticipantRef;
  role: ParticipantRole;
  reliability: AvailabilityReliability;
  /** Identity key, so a UI can join against its own participant state. */
  identityKey: string;
}

/**
 * One elementary segment of the group timeline. Participant sets are index arrays rather than
 * embedded participant objects, so a long multi-day timeline stays small.
 */
export interface GroupAvailabilitySegment extends AvailabilityInterval {
  requiredFree: number[];
  requiredBusy: number[];
  requiredTentative: number[];
  requiredUnknown: number[];
  optionalFree: number[];
  optionalBusy: number[];
  optionalTentative: number[];
  optionalUnknown: number[];
  /** Classification of this segment alone, ignoring meeting duration. */
  classification: SlotClassification;
}

export interface ParticipantConflict {
  participantIndex: number;
  reason: UnavailableReason;
}

/**
 * Deterministic, explainable score. `classification` dominates by construction: the other
 * components are clamped so they can never reorder two different classifications.
 */
export interface SlotScoreComponents {
  classification: number;
  optionalFree: number;
  optionalTentative: number;
  optionalUnknown: number;
  optionalBusy: number;
  workingHours: number;
  earliness: number;
}

export interface SlotScore {
  total: number;
  components: SlotScoreComponents;
}

export interface CandidateSlot extends AvailabilityInterval {
  classification: SlotClassification;
  requiredConflicts: ParticipantConflict[];
  optionalConflicts: ParticipantConflict[];
  /** Participants whose availability is not trustworthy for this slot, in either role. */
  unknownParticipants: number[];
  /** Participants with a soft (tentative) calendar conflict, in either role. */
  tentativeParticipants: number[];
  /** Participants outside their working window, in either role. */
  outsideWorkingHoursParticipants: number[];
  score: SlotScore;
}

export interface GroupSchedulingResult {
  range: AvailabilityInterval;
  timeZone: string;
  durationSeconds: number;
  granularitySeconds: number;
  participants: SchedulingParticipant[];
  /** Pass-through from CAL-107 so a UI can draw per-participant rows. Carries no event data. */
  availability: ParticipantAvailability[];
  segments: GroupAvailabilitySegment[];
  candidates: CandidateSlot[];
  suggestions: CandidateSlot[];
  workingHoursApplied: boolean;
  workingHoursPolicy: WorkingHoursPolicy | null;
}
