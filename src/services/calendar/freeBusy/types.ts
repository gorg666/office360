import type { ParticipantRef } from "../domain";

/**
 * Availability at a point in time. Deliberately separate from event status
 * (`CalendarEventData.status`) and from attendance status (`CalendarAttendee.status`).
 */
export type AvailabilityState = "free" | "busy" | "tentative" | "unknown";

/**
 * How much the availability answer can be trusted. `known` is the only value that
 * allows an absence of busy intervals to be reported as free.
 */
export type AvailabilityReliability =
  | "known"
  | "partial"
  | "unknown"
  | "permission-denied"
  | "unsupported"
  | "error";

/** Where the intervals came from. `none` means no adapter produced data. */
export type AvailabilitySource = "local-cache" | "remote-provider" | "none";

/**
 * Busy classification of an interval. `out-of-office` / `unavailable` are intentionally
 * absent: no connected provider reports them, and inventing the values would let the UI
 * imply a distinction nothing can supply.
 */
export type BusyType = "busy" | "tentative";

/** Half-open instant interval `[start, end)` in Unix seconds. */
export interface AvailabilityInterval {
  start: number;
  end: number;
}

export interface BusyInterval extends AvailabilityInterval {
  busyType: BusyType;
}

export type AvailabilityDiagnosticCode =
  | "no-calendars"
  | "never-synced"
  | "partial-coverage"
  | "stale-cache"
  | "unreadable-events"
  | "floating-timezone-assumed"
  | "unsupported-timezone"
  | "pending-local-projection"
  | "remote-unsupported"
  | "permission-denied"
  | "provider-error";

/**
 * Safe, provider-neutral explanation of why a result looks the way it does.
 * Never carries credentials, raw provider payloads or event details.
 */
export interface AvailabilityDiagnostic {
  code: AvailabilityDiagnosticCode;
  severity: "info" | "warning";
  /** Optional count for aggregate diagnostics (e.g. number of unreadable events). */
  count?: number;
}

export interface AvailabilityRequestOptions {
  /**
   * Cache older than this many seconds is still returned, but downgrades reliability to
   * `partial` with a `stale-cache` diagnostic. Set to `null` to disable the staleness check.
   */
  stalenessThresholdSeconds?: number | null;
  signal?: AbortSignal;
}

/**
 * Availability is asked about identities, never about events. Roles belong to the
 * scheduling layer and must not reach this request.
 */
export interface AvailabilityRequest {
  participants: readonly ParticipantRef[];
  range: AvailabilityInterval;
  /** IANA zone used to resolve all-day and floating values, and to render results. */
  timeZone: string;
  options?: AvailabilityRequestOptions;
}

export interface ParticipantAvailability {
  participant: ParticipantRef;
  reliability: AvailabilityReliability;
  source: AvailabilitySource;
  /** Merged, clipped, normalized. Carries no event metadata. */
  busy: BusyInterval[];
  range: AvailabilityInterval;
  timeZone: string;
  /** Instant the answer was computed. */
  observedAt: number;
  /** Last confirmed provider sync backing these intervals, when known. */
  dataAsOf: number | null;
  diagnostics: AvailabilityDiagnostic[];
}

export interface AvailabilityResult {
  range: AvailabilityInterval;
  timeZone: string;
  participants: ParticipantAvailability[];
}

/**
 * Optional adapter. Deliberately NOT a required method on `CalendarProvider`: most
 * providers have no Free/Busy path, and the capability matrix expresses that better than
 * a method every provider must stub out.
 */
export interface FreeBusyPort {
  readonly source: AvailabilitySource;
  /** Whether this adapter can answer for the given identity at all. */
  canAnswer(participant: ParticipantRef, request?: AvailabilityRequest): Promise<boolean> | boolean;
  queryAvailability(
    participants: readonly ParticipantRef[],
    request: AvailabilityRequest,
  ): Promise<ParticipantAvailability[]>;
}

/** Account/provider-scoped remote boundary used beneath `FreeBusyService`. */
export interface RemoteFreeBusyAdapter extends FreeBusyPort {
  readonly source: "remote-provider";
  readonly accountId: string;
  readonly providerType: "google_api" | "caldav";
}

/**
 * Future Scheduling Assistant contract. CAL-107 defines the shape only; no slot scoring,
 * ranking or recommendation is implemented, and none may be added here.
 */
export interface GroupAvailabilityRequest {
  requiredParticipants: readonly ParticipantRef[];
  optionalParticipants: readonly ParticipantRef[];
  range: AvailabilityInterval;
  timeZone: string;
  options?: AvailabilityRequestOptions;
}

export interface GroupAvailability {
  range: AvailabilityInterval;
  timeZone: string;
  availabilityByParticipant: ParticipantAvailability[];
}
