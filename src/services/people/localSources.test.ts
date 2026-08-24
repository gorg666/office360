import { beforeEach, describe, expect, it, vi } from "vitest";

const select = vi.fn();
vi.mock("@/services/db/connection", () => ({ getDb: vi.fn(async () => ({ select })) }));

import { searchLocalPeople } from "./localSources";

describe("local people sources", () => {
  beforeEach(() => select.mockReset());

  it("batches contacts and Calendar participant history without a query per person", async () => {
    select
      .mockResolvedValueOnce([{
        id: "contact-1", email: "Ada@Example.com", display_name: "Ada Lovelace",
        first_name: "Ada", last_name: "Lovelace", title: "Architect", role: null,
        organization: "Engine", avatar_url: null, last_contacted_at: 100, frequency: 4,
      }])
      .mockResolvedValueOnce([{
        attendees_json: JSON.stringify({
          version: 1,
          attendees: [
            { participant: { kind: "email", value: "one@example.com", normalizedEmail: "one@example.com" }, role: "required", status: "accepted", rsvpRequested: false, participantType: "individual", delegatedTo: [], delegatedFrom: [] },
            { participant: { kind: "email", value: "two@example.com", normalizedEmail: "two@example.com" }, role: "optional", status: "needs-action", rsvpRequested: true, participantType: "individual", delegatedTo: [], delegatedFrom: [] },
          ],
        }),
        organizer_email: null, updated_at: 100,
      }]);

    const people = await searchLocalPeople("account-1", "", 10);
    expect(people.map((person) => person.normalizedEmail)).toEqual(expect.arrayContaining([
      "ada@example.com", "one@example.com", "two@example.com",
    ]));
    expect(select).toHaveBeenCalledTimes(2);
    expect(select.mock.calls[1]?.[1]).toEqual(["account-1", 250]);
  });
});
