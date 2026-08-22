import { participantIdentityKey, type ParticipantRef } from "../domain";
import { createAccountFreeBusyService, type FreeBusyService, type ParticipantAvailability } from "../freeBusy";
import { findCandidateSlots, suggestSlots } from "./slots";
import { buildGroupTimeline } from "./timeline";
import type {
  GroupSchedulingRequest,
  GroupSchedulingResult,
  SchedulingParticipant,
} from "./types";

const DEFAULT_GRANULARITY_SECONDS = 30 * 60;
const DEFAULT_SUGGESTION_LIMIT = 3;

/**
 * Flatten required + optional into one ordered list. An identity present in both is treated
 * as required: the stricter role wins, and it must not be evaluated twice.
 */
export function flattenSchedulingParticipants(
  required: readonly ParticipantRef[],
  optional: readonly ParticipantRef[],
): SchedulingParticipant[] {
  const seen = new Set<string>();
  const participants: SchedulingParticipant[] = [];
  for (const [role, list] of [["required", required], ["optional", optional]] as const) {
    for (const participant of list) {
      const identityKey = participantIdentityKey(participant);
      if (seen.has(identityKey)) continue;
      seen.add(identityKey);
      participants.push({
        index: participants.length,
        participant,
        role,
        reliability: "unknown",
        identityKey,
      });
    }
  }
  return participants;
}

/**
 * Turns a group request into a timeline, candidate slots and suggestions.
 *
 * It never reads events: availability arrives from `FreeBusyService` as opaque busy
 * intervals, so a future remote Free/Busy adapter plugs in underneath without this engine
 * changing at all.
 */
export class SchedulingAssistantService {
  constructor(private readonly freeBusy: FreeBusyService) {}

  async planMeeting(request: GroupSchedulingRequest): Promise<GroupSchedulingResult> {
    const granularitySeconds = request.options?.granularitySeconds ?? DEFAULT_GRANULARITY_SECONDS;
    const participants = flattenSchedulingParticipants(
      request.requiredParticipants,
      request.optionalParticipants ?? [],
    );

    // One batched availability query for every participant, never one request per person.
    const availabilityResult = await this.freeBusy.queryAvailability({
      participants: participants.map((entry) => entry.participant),
      range: request.range,
      timeZone: request.timeZone,
      options: {
        stalenessThresholdSeconds: request.options?.stalenessThresholdSeconds,
        signal: request.options?.signal,
      },
    });

    const byIdentity = new Map<string, ParticipantAvailability>(
      availabilityResult.participants.map((entry) =>
        [participantIdentityKey(entry.participant), entry] as const),
    );
    const availability = participants.map((entry) => byIdentity.get(entry.identityKey)!)
      .filter((entry): entry is ParticipantAvailability => Boolean(entry));
    participants.forEach((entry, index) => {
      entry.reliability = availability[index]?.reliability ?? "unknown";
    });

    const range = availabilityResult.range;
    const segments = buildGroupTimeline(participants, availability, range);
    const candidates = findCandidateSlots({
      participants,
      availability,
      range,
      durationSeconds: request.durationSeconds,
      granularitySeconds,
      timeZone: request.timeZone,
      workingHours: request.options?.workingHours,
    });

    return {
      range,
      timeZone: request.timeZone,
      durationSeconds: request.durationSeconds,
      granularitySeconds,
      participants,
      availability,
      segments,
      candidates,
      suggestions: suggestSlots(candidates, DEFAULT_SUGGESTION_LIMIT),
      workingHoursApplied: Boolean(request.options?.workingHours),
      workingHoursPolicy: request.options?.workingHours?.policy ?? null,
    };
  }
}

/** Wires the assistant onto the only Free/Busy adapter that exists today. */
export function createAccountSchedulingAssistant(accountId: string): SchedulingAssistantService {
  return new SchedulingAssistantService(createAccountFreeBusyService(accountId));
}
