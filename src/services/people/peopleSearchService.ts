import {
  isValidPersonEmail,
  matchesPersonQuery,
  mergePersonIdentities,
  normalizePersonEmail,
  personIdentityFromEmail,
  personIdentityKey,
  scorePersonMatch,
  type DirectorySearchCapability,
  type PeopleDirectoryProvider,
  type PeopleSearchInput,
  type PeopleSearchResult,
  type RankedPersonIdentity,
} from "./domain";
import { searchLocalPeople } from "./localSources";
import {
  PeopleDirectoryPermissionError,
  resolvePeopleDirectoryProvider,
} from "./yandex360DirectoryProvider";

interface PeopleSearchDependencies {
  searchLocal?: (accountId: string | null | undefined, query: string, limit: number) => Promise<RankedPersonIdentity[]>;
  resolveDirectory?: (accountId: string | null | undefined) => Promise<PeopleDirectoryProvider | null>;
}

export class PeopleSearchService {
  private readonly searchLocal: NonNullable<PeopleSearchDependencies["searchLocal"]>;
  private readonly resolveDirectory: NonNullable<PeopleSearchDependencies["resolveDirectory"]>;

  constructor(dependencies: PeopleSearchDependencies = {}) {
    this.searchLocal = dependencies.searchLocal ?? searchLocalPeople;
    this.resolveDirectory = dependencies.resolveDirectory ?? resolvePeopleDirectoryProvider;
  }

  async search(input: PeopleSearchInput): Promise<PeopleSearchResult> {
    const query = input.query.trim();
    const limit = Math.max(1, Math.min(input.limit ?? 10, 30));
    let provider: PeopleDirectoryProvider | null = null;
    let directorySearch: DirectorySearchCapability = "unsupported";
    let directoryError: string | undefined;
    try {
      provider = await this.resolveDirectory(input.accountId);
      directorySearch = provider ? await provider.capability() : "unsupported";
    } catch (error) {
      directoryError = error instanceof Error ? error.message : "Каталог организации временно недоступен.";
    }

    const localPromise = this.searchLocal(input.accountId, query, limit);
    const directoryPromise = provider && directorySearch === "supported" && query
      ? provider.search(query, limit)
      : Promise.resolve([]);
    const [localResult, directoryResult] = await Promise.allSettled([localPromise, directoryPromise]);
    const local = localResult.status === "fulfilled" ? localResult.value : [];
    let directory: RankedPersonIdentity[] = [];
    if (directoryResult.status === "fulfilled") {
      directory = directoryResult.value;
    } else {
      directoryError = directoryResult.reason instanceof Error
        ? directoryResult.reason.message
        : "Каталог организации временно недоступен.";
      if (directoryResult.reason instanceof PeopleDirectoryPermissionError) directorySearch = "permission-denied";
    }
    if (localResult.status === "rejected" && directoryResult.status === "rejected") {
      throw localResult.reason;
    }

    const byEmail = new Map<string, RankedPersonIdentity>();
    for (const person of [...directory, ...local]) {
      if (!person.normalizedEmail || (query && !matchesPersonQuery(person, query))) continue;
      const key = personIdentityKey(person);
      const existing = byEmail.get(key);
      byEmail.set(key, existing ? mergePersonIdentities(existing, person) : person);
    }

    const manualEmail = normalizePersonEmail(query);
    if (query && isValidPersonEmail(manualEmail)) {
      const manual = personIdentityFromEmail(query);
      const key = personIdentityKey(manual);
      const existing = byEmail.get(key);
      byEmail.set(key, existing ? mergePersonIdentities(existing, manual) : manual);
    }

    const people = [...byEmail.values()]
      .sort((a, b) => scorePersonMatch(b, query) - scorePersonMatch(a, query)
        || a.normalizedEmail.localeCompare(b.normalizedEmail))
      .slice(0, limit)
      .map(({ usageScore: _usageScore, ...person }) => person);

    return {
      people,
      directorySearch,
      ...(directoryError ? { directoryError } : {}),
    };
  }
}

export const peopleSearchService = new PeopleSearchService();
