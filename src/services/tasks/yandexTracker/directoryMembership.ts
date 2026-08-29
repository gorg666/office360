import { getUser, listUsers } from "@/services/yandex360/directory";
import { Yandex360ApiError } from "@/services/yandex360/errors";
import type { DirectoryMember, DirectoryMembershipPort } from "./assigneeResolution";
import { TaskError } from "./errors";
import { normalizeEmail } from "@/utils/emailUtils";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function mapMember(raw: unknown): DirectoryMember | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = String(row.id ?? "").trim();
  if (!id) return null;
  const email = typeof row.email === "string"
    ? row.email
    : typeof asRecord(row.contacts)?.email === "string"
      ? String(asRecord(row.contacts)!.email)
      : undefined;
  return {
    id,
    email,
    nickname: typeof row.nickname === "string" ? row.nickname : undefined,
    isDismissed: Boolean(row.isDismissed ?? row.dismissed),
    isEnabled: row.isEnabled === undefined ? true : Boolean(row.isEnabled),
    isRobot: Boolean(row.isRobot ?? row.robot),
  };
}

function extractUsers(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const row = asRecord(payload);
  if (!row) return [];
  if (Array.isArray(row.users)) return row.users;
  if (Array.isArray(row.items)) return row.items;
  return [];
}

export function createDirectoryMembershipPort(accountId: string | null): DirectoryMembershipPort {
  return {
    async getMember(orgId, userId) {
      try {
        return mapMember(await getUser(orgId, userId, accountId ?? undefined));
      } catch (error) {
        if (error instanceof Yandex360ApiError) {
          if (error.status === 404) return null;
          if (error.status === 401 || error.status === 403) {
            throw new TaskError("permission-denied", "Directory access denied");
          }
        }
        throw error;
      }
    },
    async findMemberByEmail(orgId, email) {
      try {
        const payload = await listUsers(orgId, accountId ?? undefined);
        const target = normalizeEmail(email);
        return extractUsers(payload)
          .map(mapMember)
          .filter((member): member is DirectoryMember => Boolean(member))
          .filter((member) => member.email && normalizeEmail(member.email) === target);
      } catch (error) {
        if (error instanceof Yandex360ApiError && (error.status === 401 || error.status === 403)) {
          throw new TaskError("permission-denied", "Directory access denied");
        }
        throw error;
      }
    },
  };
}
