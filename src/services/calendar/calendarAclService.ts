import {
  CalendarAclError,
  isCalendarAclProvider,
  normalizeParticipantEmail,
  type CalendarAclCapabilities,
  type CalendarShareEntry,
  type CalendarShareRole,
} from "./domain";
import { refreshCalendarAccess } from "./calendarAccessService";
import { getCalendarProvider } from "./providerFactory";
import { accessForCalendar, getCalendarById } from "@/services/db/calendars";
import { isCalendarOffline } from "./calendarOfflinePolicy";

export interface CalendarAclTarget {
  accountId: string;
  calendarId: string;
}

interface CalendarAclDependencies {
  getCalendarById: typeof getCalendarById;
  getCalendarProvider: typeof getCalendarProvider;
  refreshCalendarAccess: typeof refreshCalendarAccess;
}

const defaultDependencies: CalendarAclDependencies = {
  getCalendarById,
  getCalendarProvider,
  refreshCalendarAccess,
};

export class CalendarAclService {
  constructor(private readonly dependencies: CalendarAclDependencies = defaultDependencies) {}

  async capabilities(target: CalendarAclTarget): Promise<CalendarAclCapabilities> {
    const { calendar, provider } = await this.context(target);
    const permissions = accessForCalendar(calendar).permissions;
    if (!permissions.canRead) {
      return { read: "permission-denied", write: "permission-denied", reason: "calendar-access" };
    }
    if (!isCalendarAclProvider(provider)) {
      return { read: "unsupported", write: "unsupported", reason: "provider-contract-missing" };
    }
    const discovered = await provider.discoverCalendarAcl(calendar.remote_id);
    return permissions.canManageSharing
      ? discovered
      : { ...discovered, write: "permission-denied", reason: discovered.reason ?? "calendar-access" };
  }

  async list(target: CalendarAclTarget): Promise<CalendarShareEntry[]> {
    const { calendar, provider } = await this.mutableContext(target, "read");
    return provider.listCalendarShares(calendar.remote_id);
  }

  async grant(target: CalendarAclTarget, email: string, role: CalendarShareRole): Promise<CalendarShareEntry> {
    const normalizedEmail = normalizeAclEmail(email);
    assertAssignableRole(role);
    const { calendar, provider } = await this.mutableContext(target, "write");
    const existing = await provider.listCalendarShares(calendar.remote_id);
    if (existing.some((entry) => entry.participant?.normalizedEmail === normalizedEmail)) {
      throw new CalendarAclError("duplicate-principal", "This person already has calendar access.");
    }
    const entry = await provider.grantCalendarShare(calendar.remote_id, normalizedEmail, role);
    await this.refreshAfterMutation(target.accountId, provider);
    return entry;
  }

  async updateRole(
    target: CalendarAclTarget,
    entryId: string,
    role: CalendarShareRole,
  ): Promise<CalendarShareEntry> {
    assertAssignableRole(role);
    const { calendar, provider } = await this.mutableContext(target, "write");
    const entry = await this.mutableEntry(provider, calendar.remote_id, entryId);
    const updated = await provider.updateCalendarShareRole(calendar.remote_id, entry.id, role);
    await this.refreshAfterMutation(target.accountId, provider);
    return updated;
  }

  async revoke(target: CalendarAclTarget, entryId: string): Promise<void> {
    const { calendar, provider } = await this.mutableContext(target, "write");
    const entry = await this.mutableEntry(provider, calendar.remote_id, entryId);
    await provider.revokeCalendarShare(calendar.remote_id, entry.id);
    await this.refreshAfterMutation(target.accountId, provider);
  }

  private async context(target: CalendarAclTarget) {
    const calendar = await this.dependencies.getCalendarById(target.calendarId);
    if (!calendar || calendar.account_id !== target.accountId || calendar.provider_presence === "removed") {
      throw new CalendarAclError("entry-not-found", "Calendar is unavailable.");
    }
    const provider = await this.dependencies.getCalendarProvider(target.accountId);
    return { calendar, provider };
  }

  private async mutableContext(target: CalendarAclTarget, operation: "read" | "write") {
    if (operation === "write" && isCalendarOffline()) {
      throw new CalendarAclError(
        "offline",
        "Calendar sharing changes are unavailable offline and were not queued.",
      );
    }
    const { calendar, provider } = await this.context(target);
    const permissions = accessForCalendar(calendar).permissions;
    if (operation === "write" && !permissions.canManageSharing || operation === "read" && !permissions.canRead) {
      throw new CalendarAclError("permission-denied", "You cannot manage sharing for this calendar.");
    }
    if (!isCalendarAclProvider(provider)) {
      throw new CalendarAclError("unsupported", "Calendar sharing is not supported by this provider.");
    }
    const capabilities = await provider.discoverCalendarAcl(calendar.remote_id);
    const support = capabilities[operation];
    if (support !== "supported") {
      const code = support === "permission-denied" || support === "reauthorization-required"
        ? support
        : "unsupported";
      throw new CalendarAclError(code, aclSupportMessage(support));
    }
    return { calendar, provider };
  }

  private async mutableEntry(
    provider: import("./domain").CalendarAclProvider,
    calendarRemoteId: string,
    entryId: string,
  ): Promise<CalendarShareEntry> {
    const entry = (await provider.listCalendarShares(calendarRemoteId)).find((candidate) => candidate.id === entryId);
    if (!entry) throw new CalendarAclError("entry-not-found", "Sharing entry no longer exists.", entryId);
    if (entry.isOwner) throw new CalendarAclError("owner-protected", "Owner access cannot be changed.", entryId);
    if (entry.isCurrentUser) throw new CalendarAclError("current-user-protected", "Your own access cannot be changed here.", entryId);
    if (entry.isProtected) throw new CalendarAclError("owner-protected", "Protected access cannot be changed.", entryId);
    return entry;
  }

  private async refreshAfterMutation(
    accountId: string,
    provider: Awaited<ReturnType<typeof getCalendarProvider>>,
  ): Promise<void> {
    try {
      await this.dependencies.refreshCalendarAccess(accountId, provider);
    } catch {
      throw new CalendarAclError(
        "refresh-failed",
        "Sharing changed, but calendar permissions could not be refreshed. Reload before retrying.",
      );
    }
  }
}

export const calendarAclService = new CalendarAclService();

function normalizeAclEmail(value: string): string {
  const email = normalizeParticipantEmail(value);
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new CalendarAclError("invalid-principal", "Enter a valid email address.");
  }
  return email;
}

function assertAssignableRole(role: CalendarShareRole): void {
  if (role === "owner") {
    throw new CalendarAclError("owner-protected", "Ownership transfer is not supported by this flow.");
  }
}

function aclSupportMessage(support: CalendarAclCapabilities["write"]): string {
  if (support === "permission-denied") return "The provider denied calendar sharing access.";
  if (support === "reauthorization-required") return "Reconnect this account to grant calendar sharing permission.";
  if (support === "unknown") return "Calendar sharing capability has not been confirmed.";
  return "Calendar sharing is not supported by this provider.";
}
