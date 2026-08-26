import { getAccountIdentity } from "@/services/db/accounts";
import { getCalendarsForAccount } from "@/services/db/calendars";
import { getCalendarEventsInRangeMulti } from "@/services/db/calendarEvents";
import { getCalendarRangeCoverage } from "@/services/db/calendarSyncCoverage";
import { isCurrentParticipant, type ParticipantIdentityContext, type ParticipantRef } from "../domain";
import { mergeBusyIntervals } from "./intervals";
import { dbCalendarEventToSourceEvent, projectSourceEvents } from "./projection";
import type {
  AvailabilityDiagnostic,
  AvailabilityReliability,
  AvailabilityRequest,
  FreeBusyPort,
  ParticipantAvailability,
} from "./types";

const DEFAULT_STALENESS_SECONDS = 15 * 60;

export interface LocalAccountFreeBusyDependencies {
  getAccountIdentity: typeof getAccountIdentity;
  getCalendarsForAccount: typeof getCalendarsForAccount;
  getCalendarEventsInRangeMulti: typeof getCalendarEventsInRangeMulti;
  getCalendarRangeCoverage: typeof getCalendarRangeCoverage;
  now: () => number;
}

const defaultDependencies: LocalAccountFreeBusyDependencies = {
  getAccountIdentity,
  getCalendarsForAccount,
  getCalendarEventsInRangeMulti,
  getCalendarRangeCoverage,
  now: () => Math.floor(Date.now() / 1000),
};

/**
 * Derives the signed-in account's own availability from the CAL-104 cache and its coverage
 * metadata. It never triggers a sync: a Scheduling Assistant changes range and participants
 * constantly, so refresh policy belongs to that ticket, not to every availability query.
 */
export class LocalAccountFreeBusyAdapter implements FreeBusyPort {
  readonly source = "local-cache" as const;

  constructor(
    private readonly accountId: string,
    private readonly dependencies: LocalAccountFreeBusyDependencies = defaultDependencies,
  ) {}

  private identityPromise: Promise<ParticipantIdentityContext | null> | null = null;

  private async identity(): Promise<ParticipantIdentityContext | null> {
    this.identityPromise ??= this.dependencies.getAccountIdentity(this.accountId)
      .then((account) => (account ? { accountId: account.id, email: account.email } : null))
      .catch(() => null);
    return this.identityPromise;
  }

  async canAnswer(participant: ParticipantRef): Promise<boolean> {
    const identity = await this.identity();
    return identity ? isCurrentParticipant(participant, identity) : false;
  }

  async queryAvailability(
    participants: readonly ParticipantRef[],
    request: AvailabilityRequest,
  ): Promise<ParticipantAvailability[]> {
    const identity = await this.identity();
    const observedAt = this.dependencies.now();
    if (!identity) {
      return participants.map((participant) =>
        emptyAvailability(participant, request, observedAt, "unknown", "none", []));
    }

    // Availability spans every calendar the account owns. UI visibility is a display filter
    // and must not silently remove real busy time from a scheduling answer.
    const calendars = await this.dependencies.getCalendarsForAccount(this.accountId);
    const calendarIds = calendars.map((calendar) => calendar.id);
    if (calendarIds.length === 0) {
      return participants.map((participant) =>
        emptyAvailability(participant, request, observedAt, "unknown", this.source,
          [{ code: "no-calendars", severity: "warning" }]));
    }

    const [coverage, rows] = await Promise.all([
      this.dependencies.getCalendarRangeCoverage(this.accountId, calendarIds, request.range.start, request.range.end),
      this.dependencies.getCalendarEventsInRangeMulti(this.accountId, calendarIds, request.range.start, request.range.end),
    ]);

    const projected = projectSourceEvents(
      rows.map((row) => dbCalendarEventToSourceEvent(row, identity)),
      { timeZone: request.timeZone },
    );
    const busy = mergeBusyIntervals(projected.intervals, request.range);
    const diagnostics: AvailabilityDiagnostic[] = [...projected.diagnostics];

    const staleness = request.options?.stalenessThresholdSeconds === undefined
      ? DEFAULT_STALENESS_SECONDS
      : request.options.stalenessThresholdSeconds;
    const isStale = staleness !== null
      && (coverage.lastSuccessfulSync === null || observedAt - coverage.lastSuccessfulSync > staleness);

    let reliability: AvailabilityReliability;
    if (coverage.state === "complete") {
      if (isStale) {
        reliability = "partial";
        diagnostics.push({ code: "stale-cache", severity: "info" });
      } else {
        reliability = "known";
      }
    } else if (coverage.state === "partial") {
      reliability = "partial";
      diagnostics.push({ code: "partial-coverage", severity: "warning" });
    } else if (rows.length > 0) {
      // Legacy cache without coverage metadata: the intervals are useful, the trust is not full.
      reliability = "partial";
      diagnostics.push({ code: "never-synced", severity: "warning" });
    } else {
      reliability = "unknown";
      diagnostics.push({ code: "never-synced", severity: "warning" });
    }

    // An assumed zone or an unresolvable TZID means an interval may sit in the wrong place.
    if (reliability === "known"
      && diagnostics.some((diagnostic) =>
        diagnostic.code === "floating-timezone-assumed" || diagnostic.code === "unsupported-timezone")) {
      reliability = "partial";
    }

    return participants.map((participant) => ({
      participant,
      reliability,
      source: this.source,
      busy: busy.map((interval) => ({ ...interval })),
      range: { ...request.range },
      timeZone: request.timeZone,
      observedAt,
      dataAsOf: coverage.lastSuccessfulSync,
      diagnostics: diagnostics.map((diagnostic) => ({ ...diagnostic })),
    }));
  }
}

function emptyAvailability(
  participant: ParticipantRef,
  request: AvailabilityRequest,
  observedAt: number,
  reliability: AvailabilityReliability,
  source: ParticipantAvailability["source"],
  diagnostics: AvailabilityDiagnostic[],
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
    diagnostics,
  };
}
