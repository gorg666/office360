import { getAccount } from "@/services/db/accounts";
import { getYandexUnifiedAuthStatus } from "@/services/oauth/yandexUnifiedAuth";
import { yandex360Request } from "@/services/yandex360/client";
import { Yandex360ApiError } from "@/services/yandex360/errors";
import {
  matchesPersonQuery,
  personIdentityFromEmail,
  type DirectorySearchCapability,
  type PeopleDirectoryProvider,
  type PersonIdentity,
} from "./domain";

const DIRECTORY_API = "https://api360.yandex.net/directory/v1";
const DIRECTORY_CACHE_TTL_MS = 2 * 60 * 1_000;
const MAX_ORGANIZATIONS = 100;
const MAX_USERS_PER_ORGANIZATION = 1_000;
const MAX_DIRECTORY_PAGES = 100;
const REQUIRED_DIRECTORY_SCOPES = ["directory:read_organization", "directory:read_users"] as const;

interface DirectoryCacheEntry {
  expiresAt: number;
  people: PersonIdentity[];
}

interface YandexOrganization {
  id: number | string;
  name?: string;
}

interface YandexOrganizationsResponse {
  organizations?: YandexOrganization[];
  nextPageToken?: string;
}

interface YandexUser {
  id: string;
  email?: string;
  displayName?: string;
  name?: { first?: string; last?: string };
  position?: string;
  departmentId?: number | string;
  isDismissed?: boolean;
  isEnabled?: boolean;
  isRobot?: boolean;
}

interface YandexUsersResponse {
  users?: YandexUser[];
  page?: number;
  pages?: number;
}

interface YandexDepartment {
  id: number | string;
  name?: string;
}

interface YandexDepartmentsResponse {
  departments?: YandexDepartment[];
  page?: number;
  pages?: number;
}

const directoryCache = new Map<string, DirectoryCacheEntry>();
const directoryFlights = new Map<string, Promise<PersonIdentity[]>>();

export class Yandex360PeopleDirectoryProvider implements PeopleDirectoryProvider {
  readonly id = "yandex360";

  constructor(private readonly accountId: string) {}

  async capability(): Promise<DirectorySearchCapability> {
    const account = await getAccount(this.accountId);
    if (!account || account.oauth_provider !== "yandex" || account.auth_method !== "oauth2") {
      return "unsupported";
    }
    try {
      const admin = (await getYandexUnifiedAuthStatus(this.accountId)).find((grant) => grant.id === "admin");
      if (!admin?.connected || !REQUIRED_DIRECTORY_SCOPES.every((scope) => admin.scopes.includes(scope))) {
        return "permission-denied";
      }
      return "supported";
    } catch {
      return "permission-denied";
    }
  }

  async search(query: string, limit: number): Promise<PersonIdentity[]> {
    if (!query.trim()) return [];
    try {
      const people = await loadDirectoryPeople(this.accountId);
      return people.filter((person) => matchesPersonQuery(person, query)).slice(0, limit);
    } catch (error) {
      if (error instanceof Yandex360ApiError && (error.status === 401 || error.status === 403)) {
        throw new PeopleDirectoryPermissionError();
      }
      throw error;
    }
  }
}

export class PeopleDirectoryPermissionError extends Error {
  constructor() {
    super("Каталог организации недоступен для этого аккаунта.");
    this.name = "PeopleDirectoryPermissionError";
  }
}

export async function resolvePeopleDirectoryProvider(
  accountId?: string | null,
): Promise<PeopleDirectoryProvider | null> {
  if (!accountId) return null;
  const account = await getAccount(accountId);
  if (!account || account.oauth_provider !== "yandex") return null;
  return new Yandex360PeopleDirectoryProvider(accountId);
}

export function clearYandexDirectoryMemoryCache(accountId?: string): void {
  if (accountId) {
    directoryCache.delete(accountId);
    directoryFlights.delete(accountId);
    return;
  }
  directoryCache.clear();
  directoryFlights.clear();
}

async function loadDirectoryPeople(accountId: string): Promise<PersonIdentity[]> {
  const cached = directoryCache.get(accountId);
  if (cached && cached.expiresAt > Date.now()) return cached.people;
  const pending = directoryFlights.get(accountId);
  if (pending) return pending;

  const flight = fetchDirectoryPeople(accountId)
    .then((people) => {
      directoryCache.set(accountId, { people, expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS });
      return people;
    })
    .finally(() => directoryFlights.delete(accountId));
  directoryFlights.set(accountId, flight);
  return flight;
}

async function fetchDirectoryPeople(accountId: string): Promise<PersonIdentity[]> {
  const orgs = await fetchOrganizations(accountId);
  const pages = await Promise.all(orgs.map(async (organization) => {
    const orgId = String(organization.id);
    const [users, departments] = await Promise.all([
      fetchOrganizationUsers(accountId, orgId),
      fetchOrganizationDepartments(accountId, orgId).catch(() => []),
    ]);
    return mapYandexDirectoryUsers(organization, users, departments);
  }));
  return pages.flat();
}

async function fetchOrganizations(accountId: string): Promise<YandexOrganization[]> {
  const organizations: YandexOrganization[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_DIRECTORY_PAGES && organizations.length < MAX_ORGANIZATIONS; page += 1) {
    const response = await yandex360Request<YandexOrganizationsResponse>({
      accountId,
      method: "GET",
      path: `${DIRECTORY_API}/org`,
      query: { pageSize: Math.min(100, MAX_ORGANIZATIONS), ...(pageToken ? { pageToken } : {}) },
    });
    organizations.push(...(response.organizations ?? []));
    const next = response.nextPageToken?.trim();
    if (!next || seenTokens.has(next)) break;
    seenTokens.add(next);
    pageToken = next;
  }
  return organizations.slice(0, MAX_ORGANIZATIONS);
}

async function fetchOrganizationUsers(accountId: string, orgId: string): Promise<YandexUser[]> {
  const users: YandexUser[] = [];
  for (let page = 1; page <= MAX_DIRECTORY_PAGES; page += 1) {
    const response = await yandex360Request<YandexUsersResponse>({
      accountId,
      method: "GET",
      path: `${DIRECTORY_API}/org/{orgId}/users`,
      pathParams: { orgId },
      query: { page, perPage: MAX_USERS_PER_ORGANIZATION },
    });
    users.push(...(response.users ?? []));
    if (!response.pages || page >= response.pages) break;
  }
  return users;
}

async function fetchOrganizationDepartments(accountId: string, orgId: string): Promise<YandexDepartment[]> {
  const departments: YandexDepartment[] = [];
  for (let page = 1; page <= MAX_DIRECTORY_PAGES; page += 1) {
    const response = await yandex360Request<YandexDepartmentsResponse>({
      accountId,
      method: "GET",
      path: `${DIRECTORY_API}/org/{orgId}/departments`,
      pathParams: { orgId },
      query: { page, perPage: MAX_USERS_PER_ORGANIZATION },
    });
    departments.push(...(response.departments ?? []));
    if (!response.pages || page >= response.pages) break;
  }
  return departments;
}

export function mapYandexDirectoryUsers(
  organization: YandexOrganization,
  users: readonly YandexUser[],
  departments: readonly YandexDepartment[] = [],
): PersonIdentity[] {
  const departmentNames = new Map(departments.map((department) => [String(department.id), department.name?.trim()]));
  return users.flatMap((user) => {
    if (!user.email?.trim() || user.isDismissed || user.isEnabled === false || user.isRobot) return [];
    const firstName = user.name?.first?.trim();
    const lastName = user.name?.last?.trim();
    const displayName = user.displayName?.trim() || [firstName, lastName].filter(Boolean).join(" ");
    return [personIdentityFromEmail(user.email, {
      id: `yandex360:${organization.id}:${user.id}`,
      providerId: String(user.id),
      source: "organization-directory",
      displayName: displayName || undefined,
      firstName,
      lastName,
      jobTitle: user.position,
      organization: organization.name,
      department: user.departmentId === undefined ? undefined : departmentNames.get(String(user.departmentId)),
    })];
  });
}
