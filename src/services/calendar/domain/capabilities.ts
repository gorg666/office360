export type RecurrenceScope = "instance" | "future" | "series";

export interface CalendarProviderCapabilities {
  readonly version: 1;
  readonly events: { create: boolean; update: boolean; delete: boolean };
  readonly recurrence: { read: boolean; write: boolean; scopes: RecurrenceScope[] };
  readonly rsvp: "direct" | "imip" | "none";
  readonly freeBusy: "native" | "derived" | "none";
  readonly sync: { mode: "sync-token" | "ctag" | "full"; pagination: boolean };
  readonly conflictDetection: "etag" | "sequence" | "none";
}
