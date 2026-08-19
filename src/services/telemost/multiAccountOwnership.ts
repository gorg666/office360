import {
  invalidateVerifiedBrowserAuth,
  invalidateVerifiedBrowserAuthForAccount,
  type PendingJoin,
} from "./directJoinAuth";
import { clearTelemostCapability } from "./capability";

export const TELEMOST_CONNECT_YANDEX_MESSAGE = "Подключите Яндекс ID для сервисов";

export const TELEMOST_ACCOUNT_STORAGE_PREFIXES = [
  "office360_telemost_conferences",
  "office360_telemost_visited",
  "office360_telemost_capability",
  "office360_telemost_cef_profile_ready",
  "office360_telemost_pending_join",
] as const;

export type TelemostOwnedEvent = {
  owner_account_id: string;
  epoch: number;
  payload: string;
};

export type MeetingOwnershipKind = "owned" | "external";

export function parseTelemostOwnedEvent(raw: unknown): TelemostOwnedEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const owner = typeof rec.owner_account_id === "string" ? rec.owner_account_id.trim() : "";
  const epoch = typeof rec.epoch === "number" ? rec.epoch : Number(rec.epoch);
  if (!owner || !Number.isFinite(epoch)) return null;
  const payload = rec.payload;
  return {
    owner_account_id: owner,
    epoch,
    payload: typeof payload === "string" ? payload : payload == null ? "" : String(payload),
  };
}

export function shouldAcceptOwnedTelemostEvent(
  event: TelemostOwnedEvent | null,
  currentAccountId: string | null | undefined,
  currentEpoch: number,
): boolean {
  if (!event || !currentAccountId) return false;
  return event.owner_account_id === currentAccountId && event.epoch === currentEpoch;
}

export function requireTelemostServiceAccount(
  serviceAccountId: string | null | undefined,
): string | null {
  const id = serviceAccountId?.trim() ?? "";
  return id || null;
}

export function assertOpenJoinOwnership(input: {
  pending: PendingJoin | null;
  serviceAccountId: string | null | undefined;
  wkOwnerAccountId: string | null | undefined;
  currentEpoch: number;
  authResultOwnerAccountId?: string | null;
}): "ok" | "rejected" {
  const pending = input.pending;
  const serviceAccountId = requireTelemostServiceAccount(input.serviceAccountId);
  const wkOwner = requireTelemostServiceAccount(input.wkOwnerAccountId);
  const authOwner = requireTelemostServiceAccount(input.authResultOwnerAccountId ?? serviceAccountId);
  if (!pending || !serviceAccountId || !wkOwner || !authOwner) return "rejected";
  if (!pending.ownerAccountId) return "rejected";
  if (pending.ownerAccountId !== serviceAccountId) return "rejected";
  if (pending.ownerAccountId !== wkOwner) return "rejected";
  if (pending.ownerAccountId !== authOwner) return "rejected";
  if (pending.epoch !== input.currentEpoch) return "rejected";
  return "ok";
}

export function classifyMeetingOwnership(
  meeting: { source?: string; ownerAccountId?: string | null },
  storageAccountId?: string | null,
): MeetingOwnershipKind {
  if (meeting.source === "created" || meeting.ownerAccountId) return "owned";
  if (storageAccountId && meeting.ownerAccountId === storageAccountId) return "owned";
  return "external";
}

export function canOpenMeetingUnderAccount(
  meeting: { source?: string; ownerAccountId?: string | null },
  currentAccountId: string | null | undefined,
): boolean {
  const current = requireTelemostServiceAccount(currentAccountId);
  if (!current) return false;
  if (classifyMeetingOwnership(meeting) === "external") return true;
  const owner = meeting.ownerAccountId?.trim() ?? "";
  if (!owner) return true;
  return owner === current;
}

export function stampCreatedMeetingOwner<T>(
  meeting: T,
  ownerAccountId: string,
): T & { ownerAccountId: string } {
  return { ...meeting, ownerAccountId };
}

export function clearTelemostAccountScopedData(accountId: string): void {
  const id = accountId.trim();
  if (!id) return;
  for (const prefix of TELEMOST_ACCOUNT_STORAGE_PREFIXES) {
    try { localStorage.removeItem(`${prefix}:${id}`); } catch { /* ignore */ }
    try { sessionStorage.removeItem(`${prefix}:${id}`); } catch { /* ignore */ }
  }
  clearTelemostCapability(id);
  invalidateVerifiedBrowserAuthForAccount(id);
}

export function invalidateActiveTelemostFlow(accountId?: string | null): void {
  if (accountId) invalidateVerifiedBrowserAuthForAccount(accountId);
  else invalidateVerifiedBrowserAuth();
}
