import { parseCalendarParticipants } from "@/services/calendar/domain";
import { getDb } from "@/services/db/connection";
import type { DbContact } from "@/services/db/contacts";
import {
  matchesPersonQuery,
  personIdentityFromEmail,
  type RankedPersonIdentity,
} from "./domain";

const CONTACT_CANDIDATE_LIMIT = 300;
const CALENDAR_HISTORY_LIMIT = 250;

interface CalendarParticipantRow {
  attendees_json: string | null;
  organizer_email: string | null;
  updated_at: number | null;
}

export async function searchLocalPeople(
  accountId: string | null | undefined,
  query: string,
  limit: number,
): Promise<RankedPersonIdentity[]> {
  const db = await getDb();
  const contactsPromise = db.select<DbContact[]>(
    `SELECT * FROM contacts
     WHERE deleted_at IS NULL AND email IS NOT NULL AND TRIM(email) <> ''
     ORDER BY COALESCE(last_contacted_at, 0) DESC, frequency DESC, display_name ASC
     LIMIT $1`,
    [CONTACT_CANDIDATE_LIMIT],
  );
  const historyPromise = accountId
    ? db.select<CalendarParticipantRow[]>(
      `SELECT attendees_json, organizer_email, updated_at
       FROM calendar_events
       WHERE account_id = $1 AND attendees_json IS NOT NULL
       ORDER BY COALESCE(updated_at, 0) DESC
       LIMIT $2`,
      [accountId, CALENDAR_HISTORY_LIMIT],
    )
    : Promise.resolve([]);
  const [contacts, history] = await Promise.all([contactsPromise, historyPromise]);
  const people: RankedPersonIdentity[] = contacts.map((contact) => {
    const recent = Boolean(contact.last_contacted_at || contact.frequency > 0);
    return {
      ...personIdentityFromEmail(contact.email, {
        id: `contact:${contact.id}`,
        source: "contact",
        sources: recent ? ["contact", "recent-recipient"] : ["contact"],
        displayName: contact.display_name ?? undefined,
        firstName: contact.first_name ?? undefined,
        lastName: contact.last_name ?? undefined,
        jobTitle: contact.title ?? contact.role ?? undefined,
        organization: contact.organization ?? undefined,
        avatarUrl: contact.avatar_url ?? undefined,
      }),
      usageScore: Math.min(20, Math.max(0, contact.frequency ?? 0)) + (recent ? 5 : 0),
    };
  });

  history.forEach((row, rowIndex) => {
    const set = parseCalendarParticipants(row.attendees_json, row.organizer_email);
    const refs = [
      ...(set.organizer ? [set.organizer.participant] : []),
      ...set.attendees.map((attendee) => attendee.participant),
    ];
    refs.forEach((participant) => {
      const email = participant.normalizedEmail ?? participant.value;
      if (!email.includes("@")) return;
      people.push({
        ...personIdentityFromEmail(email, {
          source: "calendar-participant",
          displayName: participant.displayName,
          providerId: participant.providerId,
        }),
        usageScore: Math.max(0, 10 - Math.floor(rowIndex / 25)),
      });
    });
  });

  return people.filter((person) => matchesPersonQuery(person, query)).slice(0, Math.max(limit * 8, limit));
}
