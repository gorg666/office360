import { normalizeEmail } from "@/utils/emailUtils";
import type { TaskPrincipalRef } from "../domain";
import { TaskError } from "./errors";
import { trackerUidOf } from "./principal";
import type { TrackerRequestContext, TrackerUser } from "@/services/yandex/trackerClient";

export interface DirectoryMember {
  id: string;
  email?: string;
  nickname?: string;
  isDismissed?: boolean;
  isEnabled?: boolean;
  isRobot?: boolean;
}

export interface DirectoryMembershipPort {
  getMember(orgId: string, userId: string): Promise<DirectoryMember | null>;
  findMemberByEmail(orgId: string, email: string): Promise<DirectoryMember[]>;
}

export interface TrackerUserPort {
  getUser(ctx: TrackerRequestContext, loginOrId: string): Promise<TrackerUser>;
  listUsers(ctx: TrackerRequestContext, page: number, perPage: number): Promise<TrackerUser[]>;
}

function isActiveMember(member: DirectoryMember): boolean {
  if (member.isDismissed) return false;
  if (member.isRobot) return false;
  if (member.isEnabled === false) return false;
  return true;
}

function matchesEmail(user: TrackerUser, email: string): boolean {
  return Boolean(user.email && normalizeEmail(user.email) === normalizeEmail(email));
}

/**
 * Strict assignee resolution:
 * TaskPrincipalRef → org membership → Tracker user → exact uid.
 * Email-domain alone is never enough.
 */
export async function resolveAssigneeStrict(input: {
  organizationId: string;
  providerOrganizationId: string;
  principal: TaskPrincipalRef;
  ctx: TrackerRequestContext;
  directory: DirectoryMembershipPort;
  trackerUsers: TrackerUserPort;
}): Promise<TaskPrincipalRef> {
  const { principal, organizationId, providerOrganizationId, ctx, directory, trackerUsers } = input;

  if (principal.organizationId && principal.organizationId !== organizationId) {
    throw new TaskError("organization-mismatch", "Assignee belongs to a different organization");
  }

  const email = principal.email?.trim();
  if (!email) {
    throw new TaskError("assignee-unresolved", "Assignee email is required");
  }

  const person = principal.person;
  const fromDirectory = person?.source === "organization-directory"
    || person?.sources?.includes("organization-directory");

  let member: DirectoryMember | null = null;
  try {
    if (person?.providerId) {
      member = await directory.getMember(providerOrganizationId, person.providerId);
    }
    if (!member) {
      const matches = await directory.findMemberByEmail(providerOrganizationId, email);
      if (matches.length > 1) {
        throw new TaskError("assignee-unresolved", "Multiple directory users match assignee email");
      }
      member = matches[0] ?? null;
    }
  } catch (error) {
    if (error instanceof TaskError) throw error;
    throw new TaskError("permission-denied", "Directory membership could not be verified", {
      cause: error,
    });
  }

  if (!member || !isActiveMember(member)) {
    if (!fromDirectory && !member) {
      throw new TaskError(
        "assignee-unresolved",
        "Assignee is not a confirmed organization member",
      );
    }
    throw new TaskError("assignee-unresolved", "Assignee is not an active organization member");
  }

  const candidates: TrackerUser[] = [];
  const tryKeys = [
    member.nickname,
    member.id,
    principal.providerUid,
    email,
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const key of [...new Set(tryKeys)]) {
    try {
      const user = await trackerUsers.getUser(ctx, key);
      if (user && !user.dismissed) candidates.push(user);
    } catch {
      // continue lookup
    }
  }

  if (candidates.length === 0) {
    // Paginated index fallback (bounded)
    for (let page = 1; page <= 5; page += 1) {
      const pageUsers = await trackerUsers.listUsers(ctx, page, 50);
      if (!pageUsers.length) break;
      for (const user of pageUsers) {
        if (user.dismissed) continue;
        const byPassport = member.id && String(user.passportUid ?? "") === String(member.id);
        const byLogin = member.nickname && user.login === member.nickname;
        const byEmail = matchesEmail(user, email);
        if (byPassport || byLogin || byEmail) candidates.push(user);
      }
      if (pageUsers.length < 50) break;
    }
  }

  const uniqueByUid = new Map<string, TrackerUser>();
  for (const user of candidates) {
    const uid = trackerUidOf(user);
    if (!uid) continue;
    uniqueByUid.set(uid, user);
  }

  if (uniqueByUid.size === 0) {
    throw new TaskError("assignee-unresolved", "Tracker user could not be resolved to a UID");
  }
  if (uniqueByUid.size > 1) {
    throw new TaskError("assignee-unresolved", "Ambiguous Tracker user match for assignee");
  }

  const resolved = [...uniqueByUid.values()][0]!;
  const uid = trackerUidOf(resolved)!;

  // Require at least one strong signal beyond email alone when possible
  const signals = [
    member.nickname && resolved.login === member.nickname,
    member.id && String(resolved.passportUid ?? "") === String(member.id),
    matchesEmail(resolved, email),
  ].filter(Boolean);
  if (signals.length < 1) {
    throw new TaskError("assignee-unresolved", "Assignee identity signals did not match Tracker user");
  }

  return {
    email: resolved.email?.trim() || email,
    displayName: resolved.display ?? person?.displayName ?? email,
    providerUid: uid,
    organizationId,
    ...(person ? { person } : {}),
  };
}
