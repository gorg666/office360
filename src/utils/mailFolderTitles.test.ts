import { describe, expect, it } from "vitest";
import { getSystemFolderTitle, SYSTEM_FOLDER_TITLE } from "./mailFolderTitles";

describe("mailFolderTitles", () => {
  it("maps system route ids to canonical English titles", () => {
    expect(getSystemFolderTitle("inbox")).toBe("Inbox");
    expect(getSystemFolderTitle("starred")).toBe("Starred");
    expect(getSystemFolderTitle("snoozed")).toBe("Snoozed");
    expect(getSystemFolderTitle("outbox")).toBe("Outbox");
    expect(getSystemFolderTitle("sent")).toBe("Sent");
    expect(getSystemFolderTitle("drafts")).toBe("Drafts");
    expect(getSystemFolderTitle("trash")).toBe("Trash");
    expect(getSystemFolderTitle("spam")).toBe("Spam");
    expect(getSystemFolderTitle("all")).toBe("All Mail");
  });

  it("does not invent titles for user folders", () => {
    expect(getSystemFolderTitle("folder-INBOX/Work")).toBeNull();
    expect(getSystemFolderTitle("custom")).toBeNull();
  });

  it("covers expected system keys", () => {
    expect(Object.keys(SYSTEM_FOLDER_TITLE).sort()).toEqual([
      "all",
      "drafts",
      "inbox",
      "outbox",
      "sent",
      "snoozed",
      "spam",
      "starred",
      "trash",
    ]);
  });
});
