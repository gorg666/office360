import type { ParticipantRef } from "./participant";

export type CalendarShareRole = "owner" | "writer" | "reader" | "free-busy-only";
export type CalendarSharePrincipalType = "user" | "group" | "domain" | "public" | "unknown";
export type CalendarAclSupport = "supported" | "unsupported" | "permission-denied" | "reauthorization-required" | "unknown";

export interface CalendarShareEntry {
  readonly id: string;
  readonly participant: ParticipantRef | null;
  readonly principalType: CalendarSharePrincipalType;
  readonly principalValue: string | null;
  readonly displayName: string | null;
  readonly role: CalendarShareRole;
  readonly isCurrentUser: boolean;
  readonly isOwner: boolean;
  readonly isProtected: boolean;
}

export interface CalendarAclCapabilities {
  readonly read: CalendarAclSupport;
  readonly write: CalendarAclSupport;
  readonly reason: string | null;
}

export interface CalendarAclProvider {
  discoverCalendarAcl(calendarRemoteId: string): Promise<CalendarAclCapabilities>;
  listCalendarShares(calendarRemoteId: string): Promise<CalendarShareEntry[]>;
  grantCalendarShare(calendarRemoteId: string, email: string, role: CalendarShareRole): Promise<CalendarShareEntry>;
  updateCalendarShareRole(calendarRemoteId: string, entryId: string, role: CalendarShareRole): Promise<CalendarShareEntry>;
  revokeCalendarShare(calendarRemoteId: string, entryId: string): Promise<void>;
}

export type CalendarAclErrorCode =
  | "unsupported"
  | "permission-denied"
  | "reauthorization-required"
  | "duplicate-principal"
  | "invalid-principal"
  | "entry-not-found"
  | "owner-protected"
  | "current-user-protected"
  | "refresh-failed"
  | "offline"
  | "provider-error";

export class CalendarAclError extends Error {
  constructor(
    readonly code: CalendarAclErrorCode,
    message: string,
    readonly entryId: string | null = null,
  ) {
    super(message);
    this.name = "CalendarAclError";
  }
}

export function isCalendarAclProvider(value: unknown): value is CalendarAclProvider {
  const candidate = value as Partial<CalendarAclProvider> | null;
  return !!candidate
    && typeof candidate.discoverCalendarAcl === "function"
    && typeof candidate.listCalendarShares === "function"
    && typeof candidate.grantCalendarShare === "function"
    && typeof candidate.updateCalendarShareRole === "function"
    && typeof candidate.revokeCalendarShare === "function";
}
