export type RecurrenceWriteScope = "single" | "series" | "this-and-future";

export type CalendarCapabilityLevel = "none" | "partial" | "full";
export type CalendarRemoteMutationCapability = "unsupported" | "remote";

export interface CalendarProviderCapabilities {
  readonly version: 2;
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
  readonly freeBusy: "native" | "derived" | "none";
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
