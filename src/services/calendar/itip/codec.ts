import ICAL from "ical.js";
import type { CalendarParticipationStatus } from "../types";
import type { InvitationMethod } from "./domain";
import { normalizedParticipantKey } from "./domain";

export function prepareItipCalendar(input: {
  source: string;
  method: InvitationMethod;
  sequence: number;
  recurrenceId?: string | null;
  recurrenceTzid?: string | null;
  organizerEmail?: string | null;
  replyingParticipant?: { email: string; status: CalendarParticipationStatus };
}): string {
  const calendar = ICAL.Component.fromString(input.source);
  calendar.updatePropertyWithValue("method", input.method);
  const events = calendar.getAllSubcomponents("vevent");
  const target = input.recurrenceId
    ? events.find((event) => String(event.getFirstPropertyValue("recurrence-id") ?? "") === input.recurrenceId)
      ?? events[0]
    : events.find((event) => !event.hasProperty("recurrence-id")) ?? events[0];
  if (!target) throw new Error("No VEVENT available for iTIP delivery");

  for (const event of events) {
    if (event !== target) calendar.removeSubcomponent(event);
  }
  target.updatePropertyWithValue("sequence", input.sequence);
  target.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
  if (input.organizerEmail && !target.hasProperty("organizer")) {
    target.updatePropertyWithValue("organizer", `mailto:${input.organizerEmail}`);
  }
  if (input.recurrenceId && !target.hasProperty("recurrence-id")) {
    const property = new ICAL.Property("recurrence-id");
    property.setValue(parseRecurrenceId(input.recurrenceId));
    if (input.recurrenceTzid) property.setParameter("tzid", input.recurrenceTzid);
    target.addProperty(property);
  }
  if (input.method === "CANCEL") target.updatePropertyWithValue("status", "CANCELLED");

  if (input.replyingParticipant) {
    const key = normalizedParticipantKey(input.replyingParticipant.email);
    for (const property of target.getAllProperties("attendee")) {
      const value = normalizedParticipantKey(String(property.getFirstValue() ?? ""));
      if (value !== key) target.removeProperty(property);
      else property.setParameter("partstat", input.replyingParticipant.status.toUpperCase());
    }
    if (!target.getAllProperties("attendee").length) {
      const attendee = new ICAL.Property("attendee");
      attendee.setValue(`mailto:${input.replyingParticipant.email}`);
      attendee.setParameter("partstat", input.replyingParticipant.status.toUpperCase());
      target.addProperty(attendee);
    }
  }
  return calendar.toString();
}

function parseRecurrenceId(value: string): InstanceType<typeof ICAL.Time> {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) {
    return new ICAL.Time({
      year: Number(date[1]), month: Number(date[2]), day: Number(date[3]), isDate: true,
    }, ICAL.Timezone.localTimezone);
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!dateTime) throw new Error("Invalid iTIP RECURRENCE-ID");
  return new ICAL.Time({
    year: Number(dateTime[1]), month: Number(dateTime[2]), day: Number(dateTime[3]),
    hour: Number(dateTime[4]), minute: Number(dateTime[5]), second: Number(dateTime[6]),
    isDate: false,
  }, dateTime[7] ? ICAL.Timezone.utcTimezone : ICAL.Timezone.localTimezone);
}

export function utf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
