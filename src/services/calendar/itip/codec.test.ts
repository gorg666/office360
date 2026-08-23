import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { generateVEvent } from "../icalHelper";
import { prepareItipCalendar } from "./codec";

const request = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "UID:uid-1",
  "SEQUENCE:2",
  "DTSTART:20261001T090000Z",
  "DTEND:20261001T100000Z",
  "ORGANIZER;SENT-BY=\"mailto:delegate@example.com\":mailto:owner@example.com",
  "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:required@example.com",
  "ATTENDEE;ROLE=OPT-PARTICIPANT;PARTSTAT=TENTATIVE:mailto:optional@example.com",
  "RRULE:FREQ=WEEKLY;COUNT=3",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("iTIP codec", () => {
  it("keeps UID, roles, organizer delegation and recurrence in REQUEST update", () => {
    const output = prepareItipCalendar({ source: request, method: "REQUEST", sequence: 3 });
    const root = ICAL.Component.fromString(output);
    const event = root.getFirstSubcomponent("vevent")!;
    expect(String(root.getFirstPropertyValue("method"))).toBe("REQUEST");
    expect(String(event.getFirstPropertyValue("uid"))).toBe("uid-1");
    expect(Number(event.getFirstPropertyValue("sequence"))).toBe(3);
    expect(event.getAllProperties("attendee").map((property) => property.getParameter("role")))
      .toEqual(["REQ-PARTICIPANT", "OPT-PARTICIPANT"]);
    expect(String(event.getFirstPropertyValue("rrule"))).toContain("FREQ=WEEKLY");
    expect(event.getFirstProperty("organizer")?.getParameter("sent-by")).toBe("mailto:delegate@example.com");
  });

  it.each(["accepted", "tentative", "declined"] as const)("emits a single %s attendee in REPLY", (status) => {
    const output = prepareItipCalendar({
      source: request,
      method: "REPLY",
      sequence: 2,
      replyingParticipant: { email: "required@example.com", status },
    });
    const event = ICAL.Component.fromString(output).getFirstSubcomponent("vevent")!;
    const attendees = event.getAllProperties("attendee");
    expect(attendees).toHaveLength(1);
    expect(attendees[0]?.getParameter("partstat")).toBe(status.toUpperCase());
  });

  it("emits occurrence-only CANCEL with RECURRENCE-ID and preserves UID", () => {
    const output = prepareItipCalendar({
      source: request,
      method: "CANCEL",
      sequence: 4,
      recurrenceId: "20261008T090000Z",
    });
    const event = ICAL.Component.fromString(output).getFirstSubcomponent("vevent")!;
    expect(String(event.getFirstPropertyValue("uid"))).toBe("uid-1");
    expect(String(event.getFirstPropertyValue("recurrence-id"))).toContain("2026-10-08");
    expect(String(event.getFirstPropertyValue("status"))).toBe("CANCELLED");
  });

  it("adds the account organizer when a newly-created event source omitted ORGANIZER", () => {
    const source = request.replace(/ORGANIZER[^\r\n]*\r\n/, "");
    const output = prepareItipCalendar({
      source, method: "REQUEST", sequence: 1, organizerEmail: "self@example.com",
    });
    const event = ICAL.Component.fromString(output).getFirstSubcomponent("vevent")!;
    expect(String(event.getFirstPropertyValue("organizer"))).toBe("mailto:self@example.com");
  });

  it("keeps RRULE and required/optional roles when wrapping a generated create payload as REQUEST", () => {
    const source = generateVEvent({
      summary: "Weekly sync",
      startTime: "2026-09-08T10:00:00Z",
      endTime: "2026-09-08T11:00:00Z",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=TU,TH",
      attendees: [
        { email: "req@example.com", role: "required" },
        { email: "opt@example.com", role: "optional" },
      ],
    }, "recurring-invite");
    const output = prepareItipCalendar({
      source,
      method: "REQUEST",
      sequence: 0,
      organizerEmail: "owner@example.com",
    });
    const root = ICAL.Component.fromString(output);
    const event = root.getFirstSubcomponent("vevent")!;
    expect(String(root.getFirstPropertyValue("method"))).toBe("REQUEST");
    expect(String(event.getFirstPropertyValue("rrule"))).toContain("FREQ=WEEKLY");
    expect(event.getAllProperties("attendee").map((property) => property.getParameter("role")))
      .toEqual(["REQ-PARTICIPANT", "OPT-PARTICIPANT"]);
  });
});
