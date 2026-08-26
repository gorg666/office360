import { getGmailClient } from "@/services/gmail/tokenManager";
import { participantIdentityKey, type ParticipantRef } from "../domain";
import { mergeBusyIntervals } from "./intervals";
import type {
  AvailabilityDiagnostic,
  AvailabilityRequest,
  ParticipantAvailability,
  RemoteFreeBusyAdapter,
} from "./types";

const GOOGLE_FREE_BUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";
const GOOGLE_BATCH_LIMIT = 50;

interface GoogleFreeBusyError { reason?: string }
interface GoogleFreeBusyCalendar {
  busy?: Array<{ start?: string; end?: string }>;
  errors?: GoogleFreeBusyError[];
}
interface GoogleFreeBusyResponse {
  calendars?: Record<string, GoogleFreeBusyCalendar>;
}

export interface GoogleRemoteFreeBusyDependencies {
  request<T>(url: string, options: RequestInit): Promise<T>;
  now(): number;
}

function defaultDependencies(accountId: string): GoogleRemoteFreeBusyDependencies {
  return {
    request: async <T>(url: string, options: RequestInit) =>
      (await getGmailClient(accountId)).request<T>(url, options),
    now: () => Math.floor(Date.now() / 1000),
  };
}

/** Privacy-limited Google Calendar `freeBusy.query`; it never calls `events.list`. */
export class GoogleRemoteFreeBusyAdapter implements RemoteFreeBusyAdapter {
  readonly source = "remote-provider" as const;
  readonly providerType = "google_api" as const;
  private readonly dependencies: GoogleRemoteFreeBusyDependencies;

  constructor(readonly accountId: string, dependencies?: GoogleRemoteFreeBusyDependencies) {
    this.dependencies = dependencies ?? defaultDependencies(accountId);
  }

  canAnswer(participant: ParticipantRef): boolean {
    return Boolean(participant.normalizedEmail);
  }

  async queryAvailability(
    participants: readonly ParticipantRef[],
    request: AvailabilityRequest,
  ): Promise<ParticipantAvailability[]> {
    throwIfAborted(request.options?.signal);
    const byEmail = new Map<string, ParticipantRef>();
    for (const participant of participants) {
      if (participant.normalizedEmail) byEmail.set(participant.normalizedEmail, participant);
    }
    const emails = [...byEmail.keys()];
    const responses = new Map<string, GoogleFreeBusyCalendar>();

    for (let offset = 0; offset < emails.length; offset += GOOGLE_BATCH_LIMIT) {
      throwIfAborted(request.options?.signal);
      const batch = emails.slice(offset, offset + GOOGLE_BATCH_LIMIT);
      try {
        const response = await this.dependencies.request<GoogleFreeBusyResponse>(GOOGLE_FREE_BUSY_URL, {
          method: "POST",
          signal: request.options?.signal,
          body: JSON.stringify({
            timeMin: new Date(request.range.start * 1000).toISOString(),
            timeMax: new Date(request.range.end * 1000).toISOString(),
            timeZone: request.timeZone,
            calendarExpansionMax: GOOGLE_BATCH_LIMIT,
            items: batch.map((id) => ({ id })),
          }),
        });
        for (const email of batch) {
          responses.set(email, response.calendars?.[email]
            ?? { errors: [{ reason: "providerError" }] });
        }
      } catch (cause) {
        if (cause instanceof Error && cause.name === "AbortError") throw cause;
        const reason = /\b403\b|forbidden|permission/i.test(cause instanceof Error ? cause.message : String(cause))
          ? "forbidden" : "providerError";
        for (const email of batch) responses.set(email, { errors: [{ reason }] });
      }
    }

    const observedAt = this.dependencies.now();
    return participants.map((participant) => {
      const calendar = participant.normalizedEmail
        ? responses.get(participant.normalizedEmail)
        : undefined;
      const error = classifyGoogleErrors(calendar?.errors);
      if (error) return empty(participant, request, observedAt, error.reliability, error.diagnostic);

      const busy = mergeBusyIntervals((calendar?.busy ?? []).flatMap((period) => {
        const start = Date.parse(period.start ?? "") / 1000;
        const end = Date.parse(period.end ?? "") / 1000;
        return Number.isFinite(start) && Number.isFinite(end)
          ? [{ start, end, busyType: "busy" as const }]
          : [];
      }), request.range);
      return {
        participant,
        reliability: "known" as const,
        source: this.source,
        busy,
        range: { ...request.range },
        timeZone: request.timeZone,
        observedAt,
        dataAsOf: observedAt,
        diagnostics: [],
      };
    }).sort((a, b) => participantIdentityKey(a.participant).localeCompare(participantIdentityKey(b.participant)));
  }
}

function classifyGoogleErrors(errors?: GoogleFreeBusyError[]): {
  reliability: "permission-denied" | "error";
  diagnostic: AvailabilityDiagnostic;
} | null {
  if (!errors?.length) return null;
  const reasons = errors.map((entry) => entry.reason?.toLowerCase() ?? "");
  const denied = reasons.some((reason) =>
    reason.includes("forbidden") || reason.includes("permission") || reason === "notfound");
  return denied
    ? { reliability: "permission-denied", diagnostic: { code: "permission-denied", severity: "warning" } }
    : { reliability: "error", diagnostic: { code: "provider-error", severity: "warning" } };
}

function empty(
  participant: ParticipantRef,
  request: AvailabilityRequest,
  observedAt: number,
  reliability: "permission-denied" | "error",
  diagnostic: AvailabilityDiagnostic,
): ParticipantAvailability {
  return {
    participant,
    reliability,
    source: "remote-provider",
    busy: [],
    range: { ...request.range },
    timeZone: request.timeZone,
    observedAt,
    dataAsOf: null,
    diagnostics: [diagnostic],
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw typeof DOMException === "function"
    ? new DOMException("Availability query aborted", "AbortError")
    : Object.assign(new Error("Availability query aborted"), { name: "AbortError" });
}
