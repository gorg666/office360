import { describe, expect, it } from "vitest";
import { dedupeCalendarAttendees, participantRefFromEmail } from "@/services/calendar/domain";
import {
  addAuthoredParticipant,
  applyAuthoringRoles,
  authoredParticipantsToInputs,
  hydrateAuthoredParticipants,
  removeAuthoredParticipant,
  setAuthoredParticipantRole,
} from "./authoredParticipants";

describe("participant authoring", () => {
  it("adds a required participant by default", () => {
    const added = addAuthoredParticipant([], "Alex@Example.com");
    expect(added.error).toBeNull();
    expect(added.list).toEqual([{ email: "Alex@Example.com", role: "required" }]);
  });

  it("adds an optional participant and can change roles in place", () => {
    const required = addAuthoredParticipant([], "req@example.com").list;
    const optional = addAuthoredParticipant(required, "opt@example.com").list;
    const withOptional = setAuthoredParticipantRole(optional, "opt@example.com", "optional");
    expect(withOptional).toEqual([
      { email: "req@example.com", role: "required" },
      { email: "opt@example.com", role: "optional" },
    ]);
    expect(setAuthoredParticipantRole(withOptional, "opt@example.com", "required")[1]?.role).toBe("required");
    expect(setAuthoredParticipantRole(withOptional, "req@example.com", "optional")[0]?.role).toBe("optional");
  });

  it("does not create a second attendee for the same identity", () => {
    const first = addAuthoredParticipant([], "User@Example.com").list;
    const duplicate = addAuthoredParticipant(first, "user@example.com");
    expect(duplicate.list).toHaveLength(1);
    expect(duplicate.error).toBe("Этот участник уже добавлен.");
  });

  it("does not author the organizer as an editable row", () => {
    const result = addAuthoredParticipant([], "owner@example.com", "OWNER@example.com");
    expect(result.list).toHaveLength(0);
    expect(result.error).toBe("Организатор уже участвует в событии.");
  });

  it("maps required/optional into the existing participant write contract", () => {
    const attendees = dedupeCalendarAttendees(authoredParticipantsToInputs([
      { email: "req@example.com", role: "required" },
      { email: "opt@example.com", role: "optional" },
    ]));
    expect(attendees.map((item) => item.role)).toEqual(["required", "optional"]);
  });

  it("preserves a selected display name through attendee authoring", () => {
    const authored = addAuthoredParticipant([], "ada@example.com", null, "Ada Lovelace").list;
    expect(authoredParticipantsToInputs(authored)).toEqual([{
      email: "ada@example.com", role: "required", displayName: "Ada Lovelace",
    }]);
  });

  it("preserves existing RSVP while changing role", () => {
    const existing = dedupeCalendarAttendees([
      { email: "req@example.com", role: "required", responseStatus: "accepted" },
    ]);
    const next = applyAuthoringRoles(existing, [{ email: "req@example.com", role: "optional" }]);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ role: "optional", status: "accepted" });
    expect(next[0]?.participant.normalizedEmail).toBe("req@example.com");
  });

  it("hydrates legacy comma-email drafts without duplicating identity", () => {
    expect(hydrateAuthoredParticipants(["One@example.com", "one@example.com", { email: "two@example.com", role: "optional" }]))
      .toEqual([
        { email: "One@example.com", role: "required" },
        { email: "two@example.com", role: "optional" },
      ]);
    expect(removeAuthoredParticipant([{ email: "one@example.com", role: "required" }], "ONE@example.com")).toEqual([]);
    expect(participantRefFromEmail("one@example.com").normalizedEmail).toBe("one@example.com");
  });
});
