import { describe, it, expect, beforeEach, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => Promise.resolve([])),
  execute: vi.fn(() => Promise.resolve({ rowsAffected: 1 })),
}));

vi.mock("@/services/db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/db/connection")>();
  return {
    ...actual,
    getDb: vi.fn(() => Promise.resolve(mockDb)),
    selectFirstBy: vi.fn(async (_query: string, params: unknown[] = []) => {
      const rows = await mockDb.select(_query, params);
      return rows[0] ?? null;
    }),
    withTransaction: vi.fn(async (fn: (db: typeof mockDb) => Promise<void>) => fn(mockDb)),
  };
});

import { getDb } from "@/services/db/connection";
import {
  getAllContacts, updateContact, deleteContact, searchContacts,
  updateContactNotes, getAttachmentsFromContact,
  getContactsFromSameDomain, getLatestAuthResult,
  getContactByEmail, saveManagedContact, upsertContact,
  parseVCard, buildVCardForContact,
  type DbContact,
  type ContactIdentity,
} from "./contacts";

describe("contacts service", () => {
  beforeEach(() => {
    vi.mocked(mockDb.select).mockReset();
    vi.mocked(mockDb.select).mockResolvedValue([]);
    vi.mocked(mockDb.execute).mockReset();
    vi.mocked(mockDb.execute).mockResolvedValue({ rowsAffected: 1 });
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as Awaited<ReturnType<typeof getDb>>);
  });

  describe("searchContacts", () => {
    it("searches contact identities and ranks identity matches", async () => {
      await searchContacts("Alias", 5);

      expect(mockDb.select).toHaveBeenCalledWith(
        expect.stringContaining("contact_identities"),
        ["%Alias%", "%alias%", "alias", 5],
      );
      expect(mockDb.select).toHaveBeenCalledWith(
        expect.stringContaining("ci.is_primary DESC"),
        expect.any(Array),
      );
    });
  });

  describe("getAllContacts", () => {
    it("calls db.select with correct SQL and default params", async () => {
      await getAllContacts();

      expect(mockDb.select).toHaveBeenCalledWith(
        expect.stringContaining("SELECT * FROM contacts"),
        [500, 0],
      );
    });

    it("passes limit and offset params", async () => {
      await getAllContacts(100, 50);

      expect(mockDb.select).toHaveBeenCalledWith(
        expect.stringContaining("LIMIT $1 OFFSET $2"),
        [100, 50],
      );
    });
  });

  describe("updateContact", () => {
    it("calls db.execute with correct SQL params", async () => {
      await updateContact("contact-123", "John Doe");

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("display_name = $1"),
        ["John Doe", "contact-123"],
      );
    });
  });

  describe("deleteContact", () => {
    it("calls db.execute with correct SQL and id", async () => {
      await deleteContact("contact-456");

      expect(mockDb.execute).toHaveBeenCalledWith(
        "DELETE FROM contacts WHERE id = $1",
        ["contact-456"],
      );
    });
  });

  describe("updateContactNotes", () => {
    it("calls db.execute with correct SQL and normalized email", async () => {
      await updateContactNotes("John@Example.COM", "Great client");

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("SET notes = $1"),
        ["Great client", "john@example.com"],
      );
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("contact_identities"),
        expect.any(Array),
      );
    });

    it("stores null for empty notes", async () => {
      await updateContactNotes("user@test.com", "");

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("SET notes = $1"),
        [null, "user@test.com"],
      );
    });
  });

  describe("getAttachmentsFromContact", () => {
    it("queries with correct JOIN and default limit", async () => {
      await getAttachmentsFromContact("sender@test.com");

      expect(mockDb.select).toHaveBeenCalledWith(
        expect.stringContaining("FROM attachments a"),
        ["sender@test.com", 5],
      );
      expect(mockDb.select).toHaveBeenCalledWith(
        expect.stringContaining("a.is_inline = 0"),
        expect.any(Array),
      );
    });

    it("passes custom limit", async () => {
      await getAttachmentsFromContact("sender@test.com", 10);

      expect(mockDb.select).toHaveBeenCalledWith(
        expect.any(String),
        ["sender@test.com", 10],
      );
    });
  });

  describe("getContactsFromSameDomain", () => {
    it("queries contacts with same domain", async () => {
      await getContactsFromSameDomain("alice@company.com");

      expect(mockDb.select).toHaveBeenCalledWith(
        expect.stringContaining("LIKE $1"),
        ["%@company.com", "alice@company.com", 5],
      );
      expect(mockDb.select).toHaveBeenCalledWith(
        expect.stringContaining("contact_identities"),
        expect.any(Array),
      );
    });

    it("returns empty array for public domains", async () => {
      const result = await getContactsFromSameDomain("user@gmail.com");

      expect(result).toEqual([]);
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it("returns empty array for email without @", async () => {
      const result = await getContactsFromSameDomain("invalid-email");

      expect(result).toEqual([]);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe("getLatestAuthResult", () => {
    it("queries most recent auth_results", async () => {
      mockDb.select.mockResolvedValueOnce([{ auth_results: '{"aggregate":"pass"}' }]);

      const result = await getLatestAuthResult("sender@test.com");

      expect(result).toBe('{"aggregate":"pass"}');
      expect(mockDb.select).toHaveBeenCalledWith(
        expect.stringContaining("auth_results FROM messages"),
        ["sender@test.com"],
      );
    });

    it("returns null when no results", async () => {
      mockDb.select.mockResolvedValueOnce([]);

      const result = await getLatestAuthResult("unknown@test.com");

      expect(result).toBeNull();
    });
  });

  describe("identity lookup and managed updates", () => {
    it("resolves a contact through contact identities", async () => {
      mockDb.select.mockResolvedValueOnce([{ id: "c-1", email: "primary@example.com" }]);

      await getContactByEmail("Alias@Example.com");

      expect(mockDb.select).toHaveBeenCalledWith(
        expect.stringContaining("contact_identities"),
        ["alias@example.com"],
      );
    });

    it("saves a managed contact with primary and secondary identities", async () => {
      const saved: DbContact = {
        id: "c-1",
        email: "primary@example.com",
        display_name: "Alice",
        avatar_url: null,
        frequency: 1,
        last_contacted_at: null,
        notes: null,
      };
      const identities: ContactIdentity[] = [
        {
          id: "i-1",
          contact_id: "c-1",
          email: "primary@example.com",
          label: null,
          display_name: null,
          is_primary: 1,
          source_type: "local",
        },
        {
          id: "i-2",
          contact_id: "c-1",
          email: "alias@example.com",
          label: null,
          display_name: null,
          is_primary: 0,
          source_type: "local",
        },
      ];
      mockDb.select
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([saved])
        .mockResolvedValueOnce(identities);

      const result = await saveManagedContact({
        displayName: "Alice",
        identities: ["Primary@Example.com", "alias@example.com"],
        primaryEmail: "primary@example.com",
      });

      expect(result.identities).toHaveLength(2);
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO contacts"),
        expect.arrayContaining(["primary@example.com", "Alice"]),
      );
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO contact_identities"),
        expect.arrayContaining(["alias@example.com"]),
      );
    });

    it("does not overwrite user-edited names on inferred upsert", async () => {
      mockDb.select.mockResolvedValueOnce([{
        id: "c-1",
        email: "alice@example.com",
        display_name: "Alice Managed",
        avatar_url: null,
        frequency: 2,
        last_contacted_at: null,
        notes: null,
        user_edited: 1,
      }]);

      await upsertContact("alice@example.com", "Alice Inferred");

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("CASE WHEN $1 = 1 THEN display_name"),
        [1, "Alice Inferred", "c-1"],
      );
    });
  });

  describe("vCard helpers", () => {
    it("parses core vCard fields and email identities", () => {
      const parsed = parseVCard([
        "BEGIN:VCARD",
        "VERSION:3.0",
        "UID:contact-1",
        "FN:Alice Example",
        "EMAIL;TYPE=PREF:Alice@Example.com",
        "EMAIL;TYPE=WORK:alias@example.com",
        "NOTE:VIP",
        "ORG:Example Inc",
        "TITLE:Director",
        "END:VCARD",
      ].join("\r\n"));

      expect(parsed).toEqual({
        uid: "contact-1",
        displayName: "Alice Example",
        emails: ["alice@example.com", "alias@example.com"],
        notes: "VIP",
        organization: "Example Inc",
        title: "Director",
      });
    });

    it("exports core contact fields to vCard", () => {
      const vcard = buildVCardForContact(
        {
          id: "c-1",
          email: "alice@example.com",
          display_name: "Alice Example",
          avatar_url: null,
          frequency: 1,
          last_contacted_at: null,
          notes: "VIP",
          vcard_uid: "contact-1",
          organization: "Example Inc",
          title: "Director",
        },
        [
          {
            id: "i-1",
            contact_id: "c-1",
            email: "alice@example.com",
            label: null,
            display_name: null,
            is_primary: 1,
            source_type: "local",
          },
          {
            id: "i-2",
            contact_id: "c-1",
            email: "alias@example.com",
            label: null,
            display_name: null,
            is_primary: 0,
            source_type: "local",
          },
        ],
      );

      expect(vcard).toContain("UID:contact-1");
      expect(vcard).toContain("FN:Alice Example");
      expect(vcard).toContain("EMAIL;TYPE=PREF:alice@example.com");
      expect(vcard).toContain("EMAIL;TYPE=INTERNET:alias@example.com");
      expect(vcard).toContain("ORG:Example Inc");
      expect(vcard).toContain("TITLE:Director");
    });
  });
});
