import {
  calendarAttendeeFromInput,
  normalizeParticipantEmail,
  participantRefFromEmail,
  sameParticipant,
  type AttendanceRole,
  type CalendarAttendee,
  type CalendarAttendeeInput,
  type ParticipantRef,
} from "@/services/calendar/domain/participant";

export type AuthoringAttendanceRole = "required" | "optional";

export interface AuthoredParticipant {
  email: string;
  role: AuthoringAttendanceRole;
}

export function defaultAuthoringRole(): AuthoringAttendanceRole {
  return "required";
}

export function authoringRoleFromAttendance(role: AttendanceRole): AuthoringAttendanceRole {
  return role === "optional" ? "optional" : "required";
}

export function addAuthoredParticipant(
  list: readonly AuthoredParticipant[],
  rawEmail: string,
  organizerEmail?: string | null,
): { list: AuthoredParticipant[]; error: string | null } {
  const email = rawEmail.trim().replace(/^mailto:/i, "");
  if (!email || !email.includes("@")) {
    return { list: [...list], error: "Укажите адрес электронной почты." };
  }
  const participant = participantRefFromEmail(email);
  if (organizerEmail && sameParticipant(participant, participantRefFromEmail(organizerEmail))) {
    return { list: [...list], error: "Организатор уже участвует в событии." };
  }
  if (list.some((row) => sameAuthoredEmail(row.email, email))) {
    return { list: [...list], error: "Этот участник уже добавлен." };
  }
  return {
    list: [...list, { email: participant.value, role: defaultAuthoringRole() }],
    error: null,
  };
}

export function setAuthoredParticipantRole(
  list: readonly AuthoredParticipant[],
  email: string,
  role: AuthoringAttendanceRole,
): AuthoredParticipant[] {
  return list.map((row) => sameAuthoredEmail(row.email, email) ? { ...row, role } : row);
}

export function removeAuthoredParticipant(
  list: readonly AuthoredParticipant[],
  email: string,
): AuthoredParticipant[] {
  return list.filter((row) => !sameAuthoredEmail(row.email, email));
}

export function hydrateAuthoredParticipants(value: unknown): AuthoredParticipant[] {
  if (!Array.isArray(value)) return [];
  const result: AuthoredParticipant[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const added = addAuthoredParticipant(result, item);
      result.splice(0, result.length, ...added.list);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as { email?: unknown; role?: unknown };
    if (typeof record.email !== "string") continue;
    const added = addAuthoredParticipant(result, record.email);
    if (added.error) continue;
    const role = record.role === "optional" ? "optional" : "required";
    result.splice(0, result.length, ...setAuthoredParticipantRole(added.list, record.email, role));
  }
  return result;
}

export function authoredParticipantsToInputs(list: readonly AuthoredParticipant[]): CalendarAttendeeInput[] {
  return list.map((row) => ({ email: row.email, role: row.role }));
}

export function attendeesToInputs(attendees: readonly CalendarAttendee[]): CalendarAttendeeInput[] {
  return attendees.map((attendee) => ({
    participant: attendee.participant,
    role: attendee.role,
    status: attendee.status,
    rsvpRequested: attendee.rsvpRequested,
    participantType: attendee.participantType,
    sentBy: attendee.sentBy,
    delegatedTo: attendee.delegatedTo,
    delegatedFrom: attendee.delegatedFrom,
    additionalGuests: attendee.additionalGuests,
  }));
}

export function attendeesToAuthoredParticipants(
  attendees: readonly CalendarAttendee[],
  organizer?: ParticipantRef | null,
): AuthoredParticipant[] {
  return attendees.flatMap((attendee) => {
    if (organizer && sameParticipant(attendee.participant, organizer)) return [];
    const email = attendee.participant.normalizedEmail ?? attendee.participant.value;
    if (!email.includes("@")) return [];
    return [{ email: attendee.participant.value, role: authoringRoleFromAttendance(attendee.role) }];
  });
}

export function applyAuthoringRoles(
  attendees: readonly CalendarAttendee[],
  authored: readonly AuthoredParticipant[],
  organizer?: ParticipantRef | null,
): CalendarAttendee[] {
  const byEmail = new Map(authored.map((row) => [normalizeParticipantEmail(row.email), row]));
  const next: CalendarAttendee[] = [];
  for (const attendee of attendees) {
    if (organizer && sameParticipant(attendee.participant, organizer)) continue;
    const key = attendee.participant.normalizedEmail ?? normalizeParticipantEmail(attendee.participant.value);
    const authoredRow = byEmail.get(key);
    if (!authoredRow) continue;
    next.push({ ...attendee, role: authoredRow.role });
    byEmail.delete(key);
  }
  for (const row of authored) {
    const key = normalizeParticipantEmail(row.email);
    if (!byEmail.has(key)) continue;
    const created = calendarAttendeeFromInput({ email: row.email, role: row.role, rsvpRequested: true });
    if (created) next.push(created);
  }
  return next;
}

function sameAuthoredEmail(a: string, b: string): boolean {
  return sameParticipant(participantRefFromEmail(a), participantRefFromEmail(b));
}
