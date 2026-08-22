export type RecurrenceWriteScope = "single" | "series" | "this-and-future";

export type CalendarCapabilityLevel = "none" | "partial" | "full";
export type CalendarRemoteMutationCapability = "unsupported" | "remote";

export type FreeBusySelfCapability = "none" | "local-derived" | "remote";
export type FreeBusyOthersCapability = "none" | "remote";

export interface CalendarProviderCapabilities {
  readonly version: 3;
  readonly read: { calendars: CalendarCapabilityLevel; events: CalendarCapabilityLevel };
  readonly events: {
    create: CalendarRemoteMutationCapability;
    update: CalendarRemoteMutationCapability;
    delete: CalendarRemoteMutationCapability;
  };
  readonly recurrence: {
    read: CalendarCapabilityLevel;
    write: CalendarCapabilityLevel;
    updateScopes: readonly RecurrenceWriteScope[];
    deleteScopes: readonly RecurrenceWriteScope[];
  };
  readonly attendees: { read: CalendarCapabilityLevel; write: CalendarCapabilityLevel };
  readonly rsvp: {
    local: "projection" | "none";
    remote: "direct" | "unsupported";
  };
  readonly invitations: "provider-native" | "email-itip" | "none";
  readonly sync: {
    mode: "sync-token" | "ctag" | "range-refresh";
    pagination: boolean;
    durability: "ephemeral" | "durable";
  };
  readonly freeBusy: {
    /**
     * Availability of the signed-in account itself. `local-derived` means it is computed
     * from the synced calendar cache and its coverage metadata, not from a provider query.
     */
    self: FreeBusySelfCapability;
    /**
     * Availability of any other identity. Stays `none` until a real remote Free/Busy
     * adapter exists — deriving it by searching local events for someone else's address
     * would be a guess, not a capability.
     */
    others: FreeBusyOthersCapability;
  };
  readonly permissions: CalendarCapabilityLevel;
  readonly sharedCalendars: "none" | "read" | "manage";
  readonly reminders: CalendarCapabilityLevel;
  readonly conflictDetection: "etag" | "sequence" | "none";
}

export function supportsRecurrenceScope(
  capabilities: CalendarProviderCapabilities,
  operation: "update" | "delete",
  scope: RecurrenceWriteScope,
): boolean {
  const scopes = operation === "update"
    ? capabilities.recurrence.updateScopes
    : capabilities.recurrence.deleteScopes;
  return scopes.includes(scope);
}
