import { normalizeEmail } from "@/utils/emailUtils";

export interface ParticipantRef {
  kind: "email" | "uri" | "account" | "provider";
  value: string;
  normalizedEmail: string | null;
  accountId?: string;
  providerId?: string;
  displayName?: string;
}

export type AttendanceRole = "required" | "optional" | "non-participant" | "chair" | "unknown";
export type AttendanceStatus = "needs-action" | "accepted" | "tentative" | "declined" | "delegated" | "unknown";
export type ParticipantType = "individual" | "group" | "resource" | "room" | "unknown";

export interface CalendarAttendee {
  participant: ParticipantRef;
  role: AttendanceRole;
  status: AttendanceStatus;
  rsvpRequested: boolean | null;
  participantType: ParticipantType;
  sentBy?: ParticipantRef;
  delegatedTo: ParticipantRef[];
  delegatedFrom: ParticipantRef[];
  additionalGuests?: number;
  rawRole?: string;
  rawStatus?: string;
  rawParticipantType?: string;
}

export interface CalendarOrganizer { participant: ParticipantRef; sentBy?: ParticipantRef }
export interface CalendarParticipantSet { organizer: CalendarOrganizer | null; attendees: CalendarAttendee[] }
export interface ParticipantIdentityContext { accountId?: string | null; providerId?: string | null; email?: string | null }

export interface CalendarAttendeeInput {
  participant?: ParticipantRef;
  email?: string;
  uri?: string;
  displayName?: string;
  role?: string;
  optional?: boolean;
  status?: string;
  responseStatus?: string;
  rsvpRequested?: boolean | null;
  rsvp?: boolean | null;
  participantType?: string;
  calendarUserType?: string;
  resource?: boolean;
  sentBy?: ParticipantRef | string;
  delegatedTo?: Array<ParticipantRef | string>;
  delegatedFrom?: Array<ParticipantRef | string>;
  additionalGuests?: number;
  rawRole?: string;
  rawStatus?: string;
  rawParticipantType?: string;
}

export interface CalendarOrganizerInput {
  participant?: ParticipantRef;
  email?: string;
  uri?: string;
  displayName?: string;
  sentBy?: ParticipantRef | string;
}

/** Existing Office360 convention case-folds the complete address; display casing is retained in value. */
export function normalizeParticipantEmail(value: string): string {
  const address = value.trim().replace(/^mailto:/i, "");
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return normalizeEmail(address);
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  let normalizedDomain = domain.toLowerCase();
  try { normalizedDomain = new URL(`http://${domain}`).hostname.toLowerCase(); } catch { /* legacy malformed input */ }
  return normalizeEmail(`${local}@${normalizedDomain}`);
}

export function participantRefFromEmail(email: string, displayName?: string): ParticipantRef {
  const value = email.trim().replace(/^mailto:/i, "");
  return {
    kind: "email",
    value,
    normalizedEmail: normalizeParticipantEmail(value),
    ...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
  };
}

export function participantRefFromUri(uri: string, displayName?: string): ParticipantRef {
  const value = uri.trim();
  if (/^mailto:/i.test(value) || /^[^\s@]+@[^\s@]+$/.test(value)) return participantRefFromEmail(value, displayName);
  return { kind: "uri", value, normalizedEmail: null, ...(displayName?.trim() ? { displayName: displayName.trim() } : {}) };
}

export function participantIdentityKey(value: ParticipantRef): string {
  if (value.accountId) return `account:${value.accountId}`;
  if (value.providerId) return `provider:${value.providerId}`;
  if (value.normalizedEmail) return `email:${value.normalizedEmail}`;
  return `uri:${value.value.trim().toLowerCase()}`;
}

export function sameParticipant(a: ParticipantRef, b: ParticipantRef): boolean {
  if (a.accountId && b.accountId) return a.accountId === b.accountId;
  if (a.providerId && b.providerId) return a.providerId === b.providerId;
  if (a.normalizedEmail && b.normalizedEmail) return a.normalizedEmail === b.normalizedEmail;
  return a.value.trim().toLowerCase() === b.value.trim().toLowerCase();
}

export function normalizeAttendanceRole(value?: string | null, optional = false): AttendanceRole {
  if (optional) return "optional";
  switch (value?.trim().toLowerCase().replace(/_/g, "-")) {
    case "req-participant": case "required": case undefined: case "": return "required";
    case "opt-participant": case "optional": return "optional";
    case "non-participant": case "informational": return "non-participant";
    case "chair": return "chair";
    default: return "unknown";
  }
}

export function normalizeAttendanceStatus(value?: string | null): AttendanceStatus {
  switch (value?.trim().toLowerCase().replace(/_/g, "-")) {
    case "needsaction": case "needs-action": case undefined: case "": return "needs-action";
    case "accepted": return "accepted"; case "tentative": return "tentative";
    case "declined": return "declined"; case "delegated": return "delegated"; default: return "unknown";
  }
}

export function normalizeParticipantType(value?: string | null, resource = false): ParticipantType {
  if (!value) return resource ? "resource" : "individual";
  switch (value.trim().toLowerCase()) {
    case "individual": return "individual"; case "group": return "group";
    case "resource": return "resource"; case "room": return "room"; default: return "unknown";
  }
}

export function calendarAttendeeFromInput(input: CalendarAttendeeInput): CalendarAttendee | null {
  const participant = input.participant
    ? normalizeRef(input.participant)
    : input.email || input.uri ? participantRefFromUri(input.email ?? input.uri!, input.displayName) : null;
  if (!participant?.value) return null;
  const sentBy = normalizeOptionalRef(input.sentBy);
  return {
    participant: input.displayName && !participant.displayName ? { ...participant, displayName: input.displayName.trim() } : participant,
    role: normalizeAttendanceRole(input.role, input.optional === true),
    status: normalizeAttendanceStatus(input.status ?? input.responseStatus),
    rsvpRequested: input.rsvpRequested ?? input.rsvp ?? null,
    participantType: normalizeParticipantType(input.participantType ?? input.calendarUserType, input.resource === true),
    ...(sentBy ? { sentBy } : {}),
    delegatedTo: normalizeRefList(input.delegatedTo), delegatedFrom: normalizeRefList(input.delegatedFrom),
    ...(Number.isFinite(input.additionalGuests) ? { additionalGuests: Math.max(0, Math.trunc(input.additionalGuests!)) } : {}),
    ...(input.rawRole ?? (!input.participant ? input.role : undefined) ? { rawRole: input.rawRole ?? input.role } : {}),
    ...(input.rawStatus ?? (!input.participant ? input.status ?? input.responseStatus : undefined) ? { rawStatus: input.rawStatus ?? input.status ?? input.responseStatus } : {}),
    ...(input.rawParticipantType ?? (!input.participant ? input.participantType ?? input.calendarUserType : undefined)
      ? { rawParticipantType: input.rawParticipantType ?? input.participantType ?? input.calendarUserType } : {}),
  };
}

export function calendarOrganizerFromInput(input?: CalendarOrganizerInput | null): CalendarOrganizer | null {
  if (!input) return null;
  const participant = input.participant ? normalizeRef(input.participant)
    : input.email || input.uri ? participantRefFromUri(input.email ?? input.uri!, input.displayName) : null;
  if (!participant?.value) return null;
  const sentBy = normalizeOptionalRef(input.sentBy);
  return { participant, ...(sentBy ? { sentBy } : {}) };
}

export function dedupeCalendarAttendees(inputs: readonly CalendarAttendeeInput[]): CalendarAttendee[] {
  const result: CalendarAttendee[] = [];
  for (const input of inputs) {
    const next = calendarAttendeeFromInput(input); if (!next) continue;
    const index = result.findIndex((value) => sameParticipant(value.participant, next.participant));
    if (index < 0) result.push(next); else result[index] = mergeCalendarAttendee(result[index]!, next);
  }
  return result;
}

export function mergeCalendarAttendee(a: CalendarAttendee, b: CalendarAttendee): CalendarAttendee {
  return {
    participant: mergeRefs(a.participant, b.participant),
    role: prefer(a.role, b.role, "required"), status: prefer(a.status, b.status, "needs-action"),
    rsvpRequested: a.rsvpRequested ?? b.rsvpRequested,
    participantType: prefer(a.participantType, b.participantType, "individual"),
    ...(a.sentBy ?? b.sentBy ? { sentBy: a.sentBy ?? b.sentBy } : {}),
    delegatedTo: mergeRefLists(a.delegatedTo, b.delegatedTo), delegatedFrom: mergeRefLists(a.delegatedFrom, b.delegatedFrom),
    ...(a.additionalGuests !== undefined || b.additionalGuests !== undefined ? { additionalGuests: Math.max(a.additionalGuests ?? 0, b.additionalGuests ?? 0) } : {}),
    ...(a.rawRole ?? b.rawRole ? { rawRole: a.rawRole ?? b.rawRole } : {}),
    ...(a.rawStatus ?? b.rawStatus ? { rawStatus: a.rawStatus ?? b.rawStatus } : {}),
    ...(a.rawParticipantType ?? b.rawParticipantType ? { rawParticipantType: a.rawParticipantType ?? b.rawParticipantType } : {}),
  };
}

export function serializeCalendarParticipants(value: CalendarParticipantSet): string | null {
  const attendees = dedupeCalendarAttendees(value.attendees);
  const organizer = calendarOrganizerFromInput(value.organizer);
  return !organizer && attendees.length === 0 ? null : JSON.stringify({ version: 1, organizer, attendees });
}

export function parseCalendarParticipants(value?: string | null, organizerEmail?: string | null): CalendarParticipantSet {
  let organizer = organizerEmail ? calendarOrganizerFromInput({ email: organizerEmail }) : null;
  let attendees: CalendarAttendee[] = [];
  try {
    const parsed: unknown = value ? JSON.parse(value) : null;
    if (Array.isArray(parsed)) attendees = dedupeCalendarAttendees(parsed.filter(isRecord) as CalendarAttendeeInput[]);
    else if (isRecord(parsed)) {
      if (isRecord(parsed.organizer)) organizer = calendarOrganizerFromInput(parsed.organizer as CalendarOrganizerInput) ?? organizer;
      if (Array.isArray(parsed.attendees)) attendees = dedupeCalendarAttendees(parsed.attendees.filter(isRecord) as CalendarAttendeeInput[]);
    }
  } catch { /* malformed legacy JSON keeps event readable */ }
  return { organizer, attendees };
}

export function isCurrentParticipant(participant: ParticipantRef, context: ParticipantIdentityContext): boolean {
  if (participant.accountId && context.accountId) return participant.accountId === context.accountId;
  if (participant.providerId && context.providerId) return participant.providerId === context.providerId;
  return Boolean(participant.normalizedEmail && context.email && participant.normalizedEmail === normalizeParticipantEmail(context.email));
}
export function findCurrentAttendee(attendees: readonly CalendarAttendee[], context: ParticipantIdentityContext): CalendarAttendee | null {
  return attendees.find((value) => isCurrentParticipant(value.participant, context)) ?? null;
}
export function isCurrentOrganizer(organizer: CalendarOrganizer | null, context: ParticipantIdentityContext): boolean {
  return organizer ? isCurrentParticipant(organizer.participant, context) : false;
}
export function withAttendeeStatus(attendees: readonly CalendarAttendee[], participant: ParticipantRef, status: AttendanceStatus): CalendarAttendee[] {
  return attendees.map((value) => sameParticipant(value.participant, participant) ? { ...value, status, rawStatus: status } : value);
}

function normalizeRef(value: ParticipantRef): ParticipantRef {
  return value.normalizedEmail || value.kind === "email" ? { ...value, value: value.value.replace(/^mailto:/i, "").trim(), normalizedEmail: normalizeParticipantEmail(value.normalizedEmail ?? value.value) } : { ...value, value: value.value.trim() };
}
function normalizeOptionalRef(value?: ParticipantRef | string): ParticipantRef | null { return typeof value === "string" ? participantRefFromUri(value) : value ? normalizeRef(value) : null }
function normalizeRefList(values?: Array<ParticipantRef | string>): ParticipantRef[] { return mergeRefLists([], (values ?? []).flatMap((value) => { const ref = normalizeOptionalRef(value); return ref ? [ref] : []; })) }
function mergeRefLists(a: readonly ParticipantRef[], b: readonly ParticipantRef[]): ParticipantRef[] { const out = [...a]; for (const ref of b) { const i = out.findIndex((value) => sameParticipant(value, ref)); if (i < 0) out.push(ref); else out[i] = mergeRefs(out[i]!, ref); } return out }
function mergeRefs(a: ParticipantRef, b: ParticipantRef): ParticipantRef { return { kind: a.accountId || b.accountId ? "account" : a.providerId || b.providerId ? "provider" : a.normalizedEmail || b.normalizedEmail ? "email" : "uri", value: a.value || b.value, normalizedEmail: a.normalizedEmail ?? b.normalizedEmail, ...(a.accountId ?? b.accountId ? { accountId: a.accountId ?? b.accountId } : {}), ...(a.providerId ?? b.providerId ? { providerId: a.providerId ?? b.providerId } : {}), ...(a.displayName ?? b.displayName ? { displayName: a.displayName ?? b.displayName } : {}) } }
function prefer<T extends string>(a: T, b: T, defaultValue: T): T { return a === "unknown" || (a === defaultValue && b !== defaultValue && b !== "unknown") ? b : a }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null }
