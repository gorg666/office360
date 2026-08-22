import { describe, expect, it } from "vitest";
import {
  calendarOrganizerFromInput,
  dedupeCalendarAttendees,
  findCurrentAttendee,
  isCurrentOrganizer,
  normalizeAttendanceRole,
  normalizeAttendanceStatus,
  normalizeParticipantEmail,
  normalizeParticipantType,
  parseCalendarParticipants,
  serializeCalendarParticipants,
} from "./participant";

describe("calendar participant domain", () => {
  it("normalizes MAILTO/casing/IDN without provider alias rewriting", () => {
    expect(normalizeParticipantEmail(" MAILTO:User@Example.COM ")).toBe("user@example.com");
    expect(normalizeParticipantEmail("User@пример.рф")).toBe("user@xn--e1afmkfd.xn--p1ai");
    expect(normalizeParticipantEmail("a+b@gmail.com")).toBe("a+b@gmail.com");
  });

  it("deduplicates equivalent email identities and merges richer metadata", () => {
    const attendees = dedupeCalendarAttendees([
      { uri: "MAILTO:User@Example.com" },
      { email: "user@example.com", displayName: "User", optional: true, responseStatus: "accepted", resource: true },
    ]);
    expect(attendees).toHaveLength(1);
    expect(attendees[0]).toMatchObject({ role: "optional", status: "accepted", participantType: "resource" });
    expect(attendees[0]?.participant.displayName).toBe("User");
  });

  it("does not merge equal display names with different identities", () => {
    expect(dedupeCalendarAttendees([
      { email: "one@example.com", displayName: "Alex" },
      { email: "two@example.com", displayName: "Alex" },
    ])).toHaveLength(2);
  });

  it("normalizes RFC and Google role/status/type vocabularies", () => {
    expect(["required", "optional", "chair", "non-participant"].map((value) => normalizeAttendanceRole(value))).toEqual(["required", "optional", "chair", "non-participant"]);
    expect(["needsAction", "accepted", "tentative", "declined", "delegated"].map(normalizeAttendanceStatus)).toEqual(["needs-action", "accepted", "tentative", "declined", "delegated"]);
    expect(["individual", "group", "room", "resource", "x-person"].map((value) => normalizeParticipantType(value))).toEqual(["individual", "group", "room", "resource", "unknown"]);
  });

  it("keeps organizer separate and resolves current user by account/email identity", () => {
    const organizer = calendarOrganizerFromInput({ email: "owner@example.com", displayName: "Owner" });
    const attendees = dedupeCalendarAttendees([{ email: "Self@Example.com", responseStatus: "tentative" }]);
    expect(isCurrentOrganizer(organizer, { email: "owner@example.com" })).toBe(true);
    expect(findCurrentAttendee(attendees, { accountId: "account-1", email: "self@example.com" })?.status).toBe("tentative");
    expect(findCurrentAttendee(attendees, { email: "other@example.com" })).toBeNull();
  });

  it("reads legacy arrays and round-trips the canonical envelope", () => {
    const legacy = parseCalendarParticipants('[{"email":"a@example.com","optional":true}]', "owner@example.com");
    expect(legacy.organizer?.participant.value).toBe("owner@example.com");
    expect(legacy.attendees[0]?.role).toBe("optional");
    expect(parseCalendarParticipants(serializeCalendarParticipants(legacy))).toEqual(legacy);
  });
});
