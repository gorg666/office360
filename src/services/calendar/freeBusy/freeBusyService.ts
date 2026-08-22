import { participantIdentityKey, type ParticipantRef } from "../domain";
import { LocalAccountFreeBusyAdapter } from "./localAccountAdapter";
import type {
  AvailabilityRequest,
  AvailabilityResult,
  FreeBusyPort,
  ParticipantAvailability,
} from "./types";

function abortError(): Error {
  return typeof DOMException === "function"
    ? new DOMException("Availability query aborted", "AbortError")
    : Object.assign(new Error("Availability query aborted"), { name: "AbortError" });
}

/**
 * Routes each requested identity to the first adapter that can answer for it. Identities
 * nobody can answer for are reported as `unsupported` — never as free.
 *
 * The API is participant-plural from the start so the future Scheduling Assistant can widen
 * the participant set without a breaking contract change.
 */
export class FreeBusyService {
  constructor(private readonly ports: readonly FreeBusyPort[]) {}

  async queryAvailability(request: AvailabilityRequest): Promise<AvailabilityResult> {
    const signal = request.options?.signal;
    if (signal?.aborted) throw abortError();

    const range = normalizeRange(request.range);
    const normalized: AvailabilityRequest = { ...request, range };
    const observedAt = Math.floor(Date.now() / 1000);

    const assignments = new Map<FreeBusyPort, ParticipantRef[]>();
    const unassigned: ParticipantRef[] = [];

    for (const participant of request.participants) {
      let port: FreeBusyPort | null = null;
      for (const candidate of this.ports) {
        if (await candidate.canAnswer(participant)) {
          port = candidate;
          break;
        }
        if (signal?.aborted) throw abortError();
      }
      if (port) {
        const bucket = assignments.get(port);
        if (bucket) bucket.push(participant);
        else assignments.set(port, [participant]);
      } else {
        unassigned.push(participant);
      }
    }
    if (signal?.aborted) throw abortError();

    const answered: ParticipantAvailability[] = [];
    for (const [port, participants] of assignments) {
      try {
        answered.push(...await port.queryAvailability(participants, normalized));
      } catch (cause) {
        if (isAbortError(cause)) throw cause;
        // Provider/storage failures never degrade into free time, and the raw cause is not
        // propagated to callers or the UI.
        for (const participant of participants) {
          answered.push(fallback(participant, normalized, observedAt, "error", port.source, "provider-error"));
        }
      }
      if (signal?.aborted) throw abortError();
    }

    for (const participant of unassigned) {
      answered.push(fallback(participant, normalized, observedAt, "unsupported", "none", "remote-unsupported"));
    }

    const order = new Map(request.participants.map((participant, index) =>
      [participantIdentityKey(participant), index] as const));
    answered.sort((a, b) =>
      (order.get(participantIdentityKey(a.participant)) ?? 0)
      - (order.get(participantIdentityKey(b.participant)) ?? 0));

    return { range, timeZone: request.timeZone, participants: answered };
  }
}

function normalizeRange(range: AvailabilityRequest["range"]): AvailabilityRequest["range"] {
  return { start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) };
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

function fallback(
  participant: ParticipantRef,
  request: AvailabilityRequest,
  observedAt: number,
  reliability: ParticipantAvailability["reliability"],
  source: ParticipantAvailability["source"],
  code: "remote-unsupported" | "provider-error",
): ParticipantAvailability {
  return {
    participant,
    reliability,
    source,
    busy: [],
    range: { ...request.range },
    timeZone: request.timeZone,
    observedAt,
    dataAsOf: null,
    diagnostics: [{ code, severity: "warning" }],
  };
}

/**
 * Wires the only adapter CAL-107 ships: local-derived availability for the signed-in
 * account. No remote Free/Busy adapter exists, so other identities resolve to `unsupported`.
 */
export function createAccountFreeBusyService(accountId: string): FreeBusyService {
  return new FreeBusyService([new LocalAccountFreeBusyAdapter(accountId)]);
}
