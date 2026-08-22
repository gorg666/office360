import { getCalendarProvider } from "../providerFactory";
import { CalDAVProvider } from "../caldavProvider";
import type { ParticipantRef } from "../domain";
import { mergeBusyIntervals } from "./intervals";
import type { AvailabilityRequest, ParticipantAvailability, RemoteFreeBusyAdapter } from "./types";

export interface CalDavRemoteFreeBusyDependencies {
  provider(accountId: string): Promise<CalDAVProvider>;
  now(): number;
}

const defaults: CalDavRemoteFreeBusyDependencies = {
  provider: async (accountId) => {
    const provider = await getCalendarProvider(accountId);
    if (!(provider instanceof CalDAVProvider)) throw new Error("CalDAV provider unavailable");
    return provider;
  },
  now: () => Math.floor(Date.now() / 1000),
};

/** Capability-gated RFC 6638 scheduling-outbox adapter. */
export class CalDavRemoteFreeBusyAdapter implements RemoteFreeBusyAdapter {
  readonly source = "remote-provider" as const;
  readonly providerType = "caldav" as const;
  private providerPromise: Promise<CalDAVProvider> | null = null;

  constructor(
    readonly accountId: string,
    private readonly dependencies: CalDavRemoteFreeBusyDependencies = defaults,
  ) {}

  private provider(): Promise<CalDAVProvider> {
    return this.providerPromise ??= this.dependencies.provider(this.accountId);
  }

  async canAnswer(participant: ParticipantRef, request?: AvailabilityRequest): Promise<boolean> {
    if (!participant.normalizedEmail) return false;
    return (await (await this.provider()).discoverRemoteFreeBusy(request?.options?.signal)).supported;
  }

  async queryAvailability(
    participants: readonly ParticipantRef[],
    request: AvailabilityRequest,
  ): Promise<ParticipantAvailability[]> {
    const observedAt = this.dependencies.now();
    const emails = participants.map((participant) => participant.normalizedEmail).filter((email): email is string => Boolean(email));
    const results = await (await this.provider()).queryRemoteFreeBusy(emails, request.range, request.options?.signal);
    const byRecipient = new Map(results.map((entry) => [entry.recipient.toLowerCase(), entry]));
    return participants.map((participant) => {
      const result = participant.normalizedEmail ? byRecipient.get(participant.normalizedEmail) : undefined;
      const status = result?.status ?? "error";
      return {
        participant,
        reliability: status,
        source: this.source,
        busy: mergeBusyIntervals(result?.busy ?? [], request.range),
        range: { ...request.range },
        timeZone: request.timeZone,
        observedAt,
        dataAsOf: status === "known" ? observedAt : null,
        diagnostics: status === "known" ? [] : [{
          code: status === "permission-denied" ? "permission-denied" as const : "provider-error" as const,
          severity: "warning" as const,
        }],
      };
    });
  }
}
