import { participantRefFromUri, type ParticipantRef } from "./participant";

export type CalendarAccessRole =
  | "owner"
  | "editor"
  | "contributor"
  | "viewer"
  | "free-busy-only"
  | "unknown";

export type CalendarOwnership = "primary" | "owned" | "shared" | "unknown";

export interface CalendarEffectivePermissions {
  canRead: boolean;
  canSeeEventDetails: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canManageSharing: boolean;
  canSeeFreeBusy: boolean;
}

export interface CalendarAccess {
  role: CalendarAccessRole;
  ownership: CalendarOwnership;
  owner: ParticipantRef | null;
  permissions: CalendarEffectivePermissions;
  source: "google-calendar-list" | "dav-current-user-privilege-set" | "unknown";
  providerRole: string | null;
}

interface CalendarAccessEnvelopeV1 {
  version: 1;
  access: CalendarAccess;
}

const LEGACY_UNKNOWN: CalendarEffectivePermissions = {
  // Pre-v37 calendars remain readable during lazy discovery, but never writable.
  canRead: true,
  canSeeEventDetails: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canManageSharing: false,
  canSeeFreeBusy: true,
};

export function unknownCalendarAccess(): CalendarAccess {
  return {
    role: "unknown",
    ownership: "unknown",
    owner: null,
    permissions: { ...LEGACY_UNKNOWN },
    source: "unknown",
    providerRole: null,
  };
}

export function calendarPermissionsForRole(role: CalendarAccessRole): CalendarEffectivePermissions {
  switch (role) {
    case "owner":
      return { canRead: true, canSeeEventDetails: true, canCreate: true, canUpdate: true, canDelete: true, canManageSharing: true, canSeeFreeBusy: true };
    case "editor":
      return { canRead: true, canSeeEventDetails: true, canCreate: true, canUpdate: true, canDelete: true, canManageSharing: false, canSeeFreeBusy: true };
    case "contributor":
      return { canRead: true, canSeeEventDetails: true, canCreate: true, canUpdate: true, canDelete: true, canManageSharing: false, canSeeFreeBusy: true };
    case "viewer":
      return { canRead: true, canSeeEventDetails: true, canCreate: false, canUpdate: false, canDelete: false, canManageSharing: false, canSeeFreeBusy: true };
    case "free-busy-only":
      return { canRead: false, canSeeEventDetails: false, canCreate: false, canUpdate: false, canDelete: false, canManageSharing: false, canSeeFreeBusy: true };
    default:
      return { ...LEGACY_UNKNOWN };
  }
}

export function googleCalendarAccess(accessRole: string | undefined, primary = false): CalendarAccess {
  const providerRole = accessRole?.trim() || null;
  const role: CalendarAccessRole = primary && !providerRole ? "owner"
    : providerRole === "owner" ? "owner"
    : providerRole === "writer" ? "editor"
      : providerRole === "writerWithoutPrivateAccess" ? "contributor"
        : providerRole === "reader" ? "viewer"
          : providerRole === "freeBusyReader" ? "free-busy-only" : "unknown";
  return {
    role,
    ownership: primary ? "primary" : role === "owner" ? "owned" : role === "unknown" ? "unknown" : "shared",
    owner: null,
    permissions: calendarPermissionsForRole(role),
    source: role === "unknown" ? "unknown" : "google-calendar-list",
    providerRole,
  };
}

export function davCalendarAccess(input: {
  privileges: readonly string[] | null;
  ownerHref?: string | null;
  currentPrincipalHref?: string | null;
  primary?: boolean;
}): CalendarAccess {
  if (!input.privileges) return unknownCalendarAccess();
  const privileges = new Set(input.privileges.map(normalizeDavPrivilege));
  const has = (...values: string[]) => values.some((value) => privileges.has(value));
  const canRead = has("read");
  const canSeeFreeBusy = canRead || has("readfreebusy");
  const canCreate = has("write", "bind");
  const canUpdate = has("write", "writecontent");
  const canDelete = has("write", "unbind");
  const canManageSharing = has("writeacl");
  const samePrincipal = urlsEqual(input.ownerHref, input.currentPrincipalHref);
  const role: CalendarAccessRole = samePrincipal || canManageSharing ? "owner"
    : canCreate && canUpdate && canDelete ? "editor"
      : canCreate || canUpdate || canDelete ? "contributor"
        : canRead ? "viewer"
          : canSeeFreeBusy ? "free-busy-only" : "unknown";
  const owner = input.ownerHref ? participantRefFromUri(input.ownerHref) : null;
  return {
    role,
    ownership: input.primary ? "primary" : samePrincipal ? "owned" : input.ownerHref ? "shared" : "unknown",
    owner,
    permissions: { canRead, canSeeEventDetails: canRead, canCreate, canUpdate, canDelete, canManageSharing, canSeeFreeBusy },
    source: "dav-current-user-privilege-set",
    providerRole: [...privileges].sort().join(" ") || null,
  };
}

export function serializeCalendarAccess(access: CalendarAccess): string {
  return JSON.stringify({ version: 1, access } satisfies CalendarAccessEnvelopeV1);
}

export function parseCalendarAccess(value: string | null | undefined): CalendarAccess {
  if (!value) return unknownCalendarAccess();
  try {
    const envelope = JSON.parse(value) as Partial<CalendarAccessEnvelopeV1>;
    if (envelope.version !== 1 || !envelope.access || !isCalendarAccessRole(envelope.access.role)) return unknownCalendarAccess();
    const access = envelope.access;
    return {
      ...unknownCalendarAccess(),
      ...access,
      owner: access.owner ?? null,
      permissions: { ...LEGACY_UNKNOWN, ...access.permissions },
      providerRole: access.providerRole ?? null,
    };
  } catch {
    return unknownCalendarAccess();
  }
}

export function collectDavPrivilegeNames(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  const result = new Set<string>();
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) { candidate.forEach(visit); return; }
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, nested] of Object.entries(candidate as Record<string, unknown>)) {
      const normalized = normalizeDavPrivilege(key);
      if (DAV_PRIVILEGES.has(normalized)) result.add(normalized);
      visit(nested);
    }
  };
  visit(value);
  return [...result];
}

const DAV_PRIVILEGES = new Set(["read", "write", "writecontent", "bind", "unbind", "readacl", "writeacl", "readfreebusy"]);

function normalizeDavPrivilege(value: string): string {
  return value.replace(/[^a-z]/gi, "").toLowerCase();
}

function urlsEqual(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  try {
    const normalize = (value: string) => new URL(value).href.replace(/\/$/, "").toLowerCase();
    return normalize(left) === normalize(right);
  } catch {
    return left.replace(/\/$/, "").toLowerCase() === right.replace(/\/$/, "").toLowerCase();
  }
}

function isCalendarAccessRole(value: unknown): value is CalendarAccessRole {
  return value === "owner" || value === "editor" || value === "contributor" || value === "viewer" || value === "free-busy-only" || value === "unknown";
}
