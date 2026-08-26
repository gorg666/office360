import { describe, expect, it, vi } from "vitest";
import { personIdentityFromEmail, type PeopleDirectoryProvider } from "./domain";
import { PeopleSearchService } from "./peopleSearchService";

describe("PeopleSearchService", () => {
  it("searches Cyrillic names and job titles and ranks an exact name first", async () => {
    const service = new PeopleSearchService({
      searchLocal: vi.fn(async () => [
        { ...personIdentityFromEmail("igor@example.com", { displayName: "Игорь Петров", jobTitle: "Инженер", source: "contact" }), usageScore: 2 },
        { ...personIdentityFromEmail("lead@example.com", { displayName: "Инженер", source: "contact" }), usageScore: 1 },
      ]),
      resolveDirectory: vi.fn(async () => null),
    });

    const result = await service.search({ query: "инженер" });
    expect(result.people.map((person) => person.email)).toEqual(["lead@example.com", "igor@example.com"]);
  });

  it("deduplicates email forms and preserves richer directory metadata", async () => {
    const directory: PeopleDirectoryProvider = {
      id: "fixture",
      capability: vi.fn(async () => "supported"),
      search: vi.fn(async () => [personIdentityFromEmail("User@Example.com", {
        source: "organization-directory", displayName: "Ada Lovelace", jobTitle: "Architect",
      })]),
    };
    const service = new PeopleSearchService({
      searchLocal: vi.fn(async () => [{ ...personIdentityFromEmail("mailto:user@example.com", { source: "recent-recipient" }), usageScore: 9 }]),
      resolveDirectory: vi.fn(async () => directory),
    });

    const result = await service.search({ query: "user@example.com" });
    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toMatchObject({ displayName: "Ada Lovelace", jobTitle: "Architect" });
    expect(result.people[0]?.sources).toEqual(expect.arrayContaining(["organization-directory", "recent-recipient", "manual"]));
  });

  it("keeps local/manual fallback when the organization directory is unavailable", async () => {
    const directory: PeopleDirectoryProvider = {
      id: "fixture",
      capability: vi.fn(async () => "permission-denied"),
      search: vi.fn(),
    };
    const service = new PeopleSearchService({
      searchLocal: vi.fn(async () => []),
      resolveDirectory: vi.fn(async () => directory),
    });

    const result = await service.search({ query: "manual@example.com" });
    expect(result.directorySearch).toBe("permission-denied");
    expect(result.people).toEqual([expect.objectContaining({ email: "manual@example.com", source: "manual" })]);
    expect(directory.search).not.toHaveBeenCalled();
  });

  it("does not offer arbitrary non-email text as a manual identity", async () => {
    const service = new PeopleSearchService({
      searchLocal: vi.fn(async () => []), resolveDirectory: vi.fn(async () => null),
    });
    expect((await service.search({ query: "not an address" })).people).toEqual([]);
  });
});
