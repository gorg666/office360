import { normalizeEmail } from "@/utils/emailUtils";

export type PersonSource =
  | "organization-directory"
  | "contact"
  | "recent-recipient"
  | "calendar-participant"
  | "manual";

export type DirectorySearchCapability = "supported" | "unsupported" | "permission-denied";

export interface PersonIdentity {
  id: string;
  email: string;
  normalizedEmail: string;
  providerId?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  organization?: string;
  department?: string;
  avatarUrl?: string;
  source: PersonSource;
  sources: PersonSource[];
}

export interface PeopleSearchInput {
  accountId?: string | null;
  query: string;
  limit?: number;
}

export interface PeopleSearchResult {
  people: PersonIdentity[];
  directorySearch: DirectorySearchCapability;
  directoryError?: string;
}

export interface PeopleDirectoryProvider {
  readonly id: string;
  capability(): Promise<DirectorySearchCapability>;
  search(query: string, limit: number): Promise<PersonIdentity[]>;
}

export interface RankedPersonIdentity extends PersonIdentity {
  usageScore?: number;
}

const SOURCE_PRIORITY: Record<PersonSource, number> = {
  "organization-directory": 5,
  contact: 4,
  "recent-recipient": 3,
  "calendar-participant": 2,
  manual: 1,
};

export function normalizePersonEmail(value: string): string {
  return normalizeEmail(value.trim().replace(/^mailto:/i, ""));
}

export function personIdentityFromEmail(
  email: string,
  options: Partial<Omit<PersonIdentity, "id" | "email" | "normalizedEmail" | "source" | "sources">> & {
    id?: string;
    source?: PersonSource;
    sources?: PersonSource[];
  } = {},
): PersonIdentity {
  const value = email.trim().replace(/^mailto:/i, "");
  const normalizedEmail = normalizePersonEmail(value);
  const source = options.source ?? "manual";
  return {
    id: options.id ?? `email:${normalizedEmail}`,
    email: value,
    normalizedEmail,
    source,
    sources: uniqueSources(options.sources?.length ? options.sources : [source]),
    ...(options.providerId ? { providerId: options.providerId } : {}),
    ...(options.displayName?.trim() ? { displayName: options.displayName.trim() } : {}),
    ...(options.firstName?.trim() ? { firstName: options.firstName.trim() } : {}),
    ...(options.lastName?.trim() ? { lastName: options.lastName.trim() } : {}),
    ...(options.jobTitle?.trim() ? { jobTitle: options.jobTitle.trim() } : {}),
    ...(options.organization?.trim() ? { organization: options.organization.trim() } : {}),
    ...(options.department?.trim() ? { department: options.department.trim() } : {}),
    ...(options.avatarUrl?.trim() ? { avatarUrl: options.avatarUrl.trim() } : {}),
  };
}

export function personIdentityKey(person: Pick<PersonIdentity, "email" | "normalizedEmail">): string {
  return `email:${person.normalizedEmail || normalizePersonEmail(person.email)}`;
}

export function personDisplayName(person: PersonIdentity): string {
  return clean(person.displayName)
    ?? clean([person.firstName, person.lastName].filter(Boolean).join(" "))
    ?? person.email;
}

export function mergePersonIdentities(
  left: RankedPersonIdentity,
  right: RankedPersonIdentity,
): RankedPersonIdentity {
  const preferred = SOURCE_PRIORITY[right.source] > SOURCE_PRIORITY[left.source] ? right : left;
  const fallback = preferred === left ? right : left;
  const pick = (key: keyof PersonIdentity): string | undefined =>
    clean(preferred[key] as string | undefined) ?? clean(fallback[key] as string | undefined);
  const sources = uniqueSources([...left.sources, left.source, ...right.sources, right.source]);

  return {
    id: pick("providerId") ? (preferred.providerId ? preferred.id : fallback.id) : preferred.id,
    email: preferred.email || fallback.email,
    normalizedEmail: preferred.normalizedEmail || fallback.normalizedEmail,
    source: sources.sort((a, b) => SOURCE_PRIORITY[b] - SOURCE_PRIORITY[a])[0] ?? preferred.source,
    sources,
    ...(pick("providerId") ? { providerId: pick("providerId") } : {}),
    ...(pick("displayName") ? { displayName: pick("displayName") } : {}),
    ...(pick("firstName") ? { firstName: pick("firstName") } : {}),
    ...(pick("lastName") ? { lastName: pick("lastName") } : {}),
    ...(pick("jobTitle") ? { jobTitle: pick("jobTitle") } : {}),
    ...(pick("organization") ? { organization: pick("organization") } : {}),
    ...(pick("department") ? { department: pick("department") } : {}),
    ...(pick("avatarUrl") ? { avatarUrl: pick("avatarUrl") } : {}),
    usageScore: Math.max(left.usageScore ?? 0, right.usageScore ?? 0),
  };
}

export function normalizePeopleSearchText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
}

export function matchesPersonQuery(person: PersonIdentity, query: string): boolean {
  const needle = normalizePeopleSearchText(query);
  if (!needle) return true;
  return personSearchFields(person).some((field) => normalizePeopleSearchText(field).includes(needle));
}

export function scorePersonMatch(person: RankedPersonIdentity, query: string): number {
  const needle = normalizePeopleSearchText(query);
  if (!needle) return (person.usageScore ?? 0) + SOURCE_PRIORITY[person.source] * 10;
  const email = normalizePeopleSearchText(person.normalizedEmail);
  const displayName = normalizePeopleSearchText(personDisplayName(person));
  const firstName = normalizePeopleSearchText(person.firstName ?? "");
  const lastName = normalizePeopleSearchText(person.lastName ?? "");
  const jobTitle = normalizePeopleSearchText(person.jobTitle ?? "");
  let match = 0;
  if (email === needle) match = 1_000;
  else if ([displayName, firstName, lastName].includes(needle)) match = 950;
  else if (email.startsWith(needle)) match = 850;
  else if ([displayName, firstName, lastName].some((value) => value.startsWith(needle))) match = 800;
  else if (email.includes(needle)) match = 700;
  else if ([displayName, firstName, lastName].some((value) => value.includes(needle))) match = 650;
  else if (jobTitle.includes(needle)) match = 550;
  else if (personSearchFields(person).some((field) => normalizePeopleSearchText(field).includes(needle))) match = 500;
  return match + SOURCE_PRIORITY[person.source] * 10 + Math.min(person.usageScore ?? 0, 25);
}

function personSearchFields(person: PersonIdentity): string[] {
  return [
    person.email,
    person.displayName,
    person.firstName,
    person.lastName,
    [person.firstName, person.lastName].filter(Boolean).join(" "),
    [person.lastName, person.firstName].filter(Boolean).join(" "),
    person.jobTitle,
    person.organization,
    person.department,
  ].filter((value): value is string => Boolean(clean(value)));
}

function clean(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function uniqueSources(sources: readonly PersonSource[]): PersonSource[] {
  return [...new Set(sources)];
}
