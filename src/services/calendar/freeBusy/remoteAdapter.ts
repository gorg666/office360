import { getAccount, type DbAccount } from "@/services/db/accounts";
import { isYandexOAuthCalendarAccount } from "../yandex";
import { GoogleRemoteFreeBusyAdapter } from "./googleRemoteAdapter";
import { CalDavRemoteFreeBusyAdapter } from "./caldavRemoteAdapter";
import type {
  AvailabilityRequest,
  FreeBusyPort,
  ParticipantAvailability,
  RemoteFreeBusyAdapter,
} from "./types";
import type { ParticipantRef } from "../domain";

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  expiresAt: number;
  value: ParticipantAvailability[];
}

export interface AccountRemoteFreeBusyDependencies {
  getAccount: typeof getAccount;
  google(accountId: string): RemoteFreeBusyAdapter;
  caldav(accountId: string): RemoteFreeBusyAdapter;
  now(): number;
}

const defaults: AccountRemoteFreeBusyDependencies = {
  getAccount,
  google: (accountId) => new GoogleRemoteFreeBusyAdapter(accountId),
  caldav: (accountId) => new CalDavRemoteFreeBusyAdapter(accountId),
  now: () => Date.now(),
};

/**
 * Account-scoped router for real remote adapters. Unsupported CalDAV/Yandex accounts stay
 * unsupported until RFC 6638 discovery proves a usable scheduling endpoint.
 */
export class AccountRemoteFreeBusyAdapter implements FreeBusyPort {
  readonly source = "remote-provider" as const;
  private accountPromise: Promise<DbAccount | null> | null = null;
  private delegatePromise: Promise<RemoteFreeBusyAdapter | null> | null = null;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<ParticipantAvailability[]>>();

  constructor(
    readonly accountId: string,
    private readonly dependencies: AccountRemoteFreeBusyDependencies = defaults,
  ) {}

  private account(): Promise<DbAccount | null> {
    return this.accountPromise ??= this.dependencies.getAccount(this.accountId).catch(() => null);
  }

  private delegate(): Promise<RemoteFreeBusyAdapter | null> {
    return this.delegatePromise ??= this.account().then((account) => {
      if (!account) return null;
      if (account.provider === "gmail_api" || account.calendar_provider === "google_api") {
        return this.dependencies.google(this.accountId);
      }
      if (account.provider === "caldav" || account.calendar_provider === "caldav"
        || isYandexOAuthCalendarAccount(account)) return this.dependencies.caldav(this.accountId);
      return null;
    });
  }

  async canAnswer(participant: ParticipantRef, request?: AvailabilityRequest): Promise<boolean> {
    try {
      return (await this.delegate())?.canAnswer(participant, request) ?? false;
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") throw cause;
      return false;
    }
  }

  async queryAvailability(
    participants: readonly ParticipantRef[],
    request: AvailabilityRequest,
  ): Promise<ParticipantAvailability[]> {
    const delegate = await this.delegate();
    if (!delegate) return [];
    const key = cacheKey(this.accountId, delegate.providerType, participants, request);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.dependencies.now()) return clone(cached.value);

    const existing = this.pending.get(key);
    if (existing) return clone(await existing);

    const query = delegate.queryAvailability(participants, request).then((value) => {
      this.cache.set(key, { expiresAt: this.dependencies.now() + CACHE_TTL_MS, value: clone(value) });
      return value;
    });
    this.pending.set(key, query);
    try {
      return clone(await query);
    } finally {
      if (this.pending.get(key) === query) this.pending.delete(key);
    }
  }
}

const adapters = new Map<string, AccountRemoteFreeBusyAdapter>();

export function getAccountRemoteFreeBusyAdapter(accountId: string): AccountRemoteFreeBusyAdapter {
  let adapter = adapters.get(accountId);
  if (!adapter) {
    adapter = new AccountRemoteFreeBusyAdapter(accountId);
    adapters.set(accountId, adapter);
  }
  return adapter;
}

function cacheKey(
  accountId: string,
  providerType: string,
  participants: readonly ParticipantRef[],
  request: AvailabilityRequest,
): string {
  const identities = participants.map((participant) => participant.normalizedEmail ?? participant.value)
    .map((value) => value.trim().toLowerCase()).sort().join(",");
  return `${providerType}:${accountId}:${request.range.start}:${request.range.end}:${request.timeZone}:${identities}`;
}

function clone(value: ParticipantAvailability[]): ParticipantAvailability[] {
  return value.map((entry) => ({
    ...entry,
    participant: { ...entry.participant },
    range: { ...entry.range },
    busy: entry.busy.map((interval) => ({ ...interval })),
    diagnostics: entry.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  }));
}
