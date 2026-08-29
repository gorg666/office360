import { listUsers } from "@/services/yandex360/directory";
import { Yandex360ApiError } from "@/services/yandex360/errors";
import {
  matchesPersonQuery,
  personDisplayName,
  personIdentityFromEmail,
  type DirectorySearchCapability,
  type PersonIdentity,
} from "@/services/people/domain";
import { TaskError } from "./yandexTracker/errors";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function extractUsers(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const row = asRecord(payload);
  if (!row) return [];
  if (Array.isArray(row.users)) return row.users;
  if (Array.isArray(row.items)) return row.items;
  return [];
}

function mapDirectoryUser(raw: unknown, organizationId: string): PersonIdentity | null {
  const row = asRecord(raw);
  if (!row) return null;
  if (row.isDismissed || row.dismissed || row.isRobot || row.robot) return null;
  if (row.isEnabled === false) return null;

  const id = String(row.id ?? "").trim();
  const email = typeof row.email === "string"
    ? row.email
    : typeof asRecord(row.contacts)?.email === "string"
      ? String(asRecord(row.contacts)!.email)
      : "";
  if (!id || !email.trim()) return null;

  const name = asRecord(row.name);
  const firstName = typeof name?.first === "string" ? name.first
    : typeof row.firstName === "string" ? row.firstName : undefined;
  const lastName = typeof name?.last === "string" ? name.last
    : typeof row.lastName === "string" ? row.lastName : undefined;
  const displayName = typeof row.displayName === "string"
    ? row.displayName
    : [firstName, lastName].filter(Boolean).join(" ") || undefined;
  const department = asRecord(row.department);
  const position = typeof row.position === "string" ? row.position
    : typeof row.jobTitle === "string" ? row.jobTitle
    : typeof row.title === "string" ? row.title : undefined;

  return personIdentityFromEmail(email, {
    id: `dir:${organizationId}:${id}`,
    providerId: id,
    source: "organization-directory",
    sources: ["organization-directory"],
    displayName,
    firstName,
    lastName,
    jobTitle: position,
    organization: organizationId,
    department: typeof department?.name === "string" ? department.name
      : typeof row.department === "string" ? row.department : undefined,
  });
}

export interface OrganizationMemberSearchResult {
  people: PersonIdentity[];
  directorySearch: DirectorySearchCapability;
  directoryError?: string;
}

export async function searchOrganizationMembers(input: {
  accountId: string;
  organizationId: string;
  query: string;
  limit?: number;
  listDirectoryUsers?: typeof listUsers;
}): Promise<OrganizationMemberSearchResult> {
  const limit = input.limit ?? 20;
  try {
    const payload = await (input.listDirectoryUsers ?? listUsers)(
      input.organizationId,
      input.accountId,
    );
    const people = extractUsers(payload)
      .map((row) => mapDirectoryUser(row, input.organizationId))
      .filter((person): person is PersonIdentity => Boolean(person))
      .filter((person) => !input.query.trim() || matchesPersonQuery(person, input.query))
      .slice(0, limit);

    return { people, directorySearch: "supported" };
  } catch (error) {
    if (error instanceof Yandex360ApiError && (error.status === 401 || error.status === 403)) {
      return {
        people: [],
        directorySearch: "permission-denied",
        directoryError: "Не удалось подтвердить сотрудника организации",
      };
    }
    if (error instanceof TaskError && error.code === "permission-denied") {
      return {
        people: [],
        directorySearch: "permission-denied",
        directoryError: "Не удалось подтвердить сотрудника организации",
      };
    }
    throw error;
  }
}

export function formatAssigneeLabel(person: PersonIdentity): string {
  const name = personDisplayName(person);
  return name === person.email ? person.email : `${name} · ${person.email}`;
}
