import { describe, expect, it } from "vitest";
import {
  buildFolderTree,
  flattenFolderTree,
  isInboxChildPath,
  partitionUserFolders,
} from "./folderTree";
import type { Label } from "@/stores/labelStore";

function label(partial: Partial<Label> & Pick<Label, "id" | "name">): Label {
  return {
    accountId: "a1",
    type: "user",
    colorBg: null,
    colorFg: null,
    sortOrder: 0,
    imapFolderPath: partial.imapFolderPath ?? partial.name,
    imapSpecialUse: null,
    ...partial,
  };
}

describe("folderTree", () => {
  it("detects inbox children", () => {
    expect(isInboxChildPath("INBOX/Work")).toBe(true);
    expect(isInboxChildPath("Входящие/Личное")).toBe(true);
    expect(isInboxChildPath("Sent")).toBe(false);
    expect(isInboxChildPath("INBOX")).toBe(false);
  });

  it("builds parent/child hierarchy from paths", () => {
    const tree = buildFolderTree([
      label({ id: "folder-a", name: "Projects", imapFolderPath: "Projects" }),
      label({ id: "folder-b", name: "Alpha", imapFolderPath: "Projects/Alpha" }),
      label({ id: "folder-c", name: "Beta", imapFolderPath: "Projects/Beta" }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.label.name).toBe("Projects");
    expect(tree[0]?.children.map((c) => c.label.name).sort()).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("flattens with expanded state", () => {
    const tree = buildFolderTree([
      label({ id: "1", name: "Projects", imapFolderPath: "Projects" }),
      label({ id: "2", name: "Alpha", imapFolderPath: "Projects/Alpha" }),
    ]);
    const collapsed = flattenFolderTree(tree, new Set());
    expect(collapsed.map((n) => n.label.name)).toEqual(["Projects"]);
    const expanded = flattenFolderTree(tree, new Set(["Projects"]));
    expect(expanded.map((n) => n.label.name)).toEqual(["Projects", "Alpha"]);
  });

  it("partitions under-inbox vs other folders", () => {
    const { underInbox, other } = partitionUserFolders([
      label({ id: "1", name: "Work", imapFolderPath: "INBOX/Work" }),
      label({ id: "2", name: "Archive-custom", imapFolderPath: "MyArchive" }),
    ]);
    expect(underInbox.map((l) => l.id)).toEqual(["1"]);
    expect(other.map((l) => l.id)).toEqual(["2"]);
  });

  it("excludes SPECIAL-USE system folders from trees", () => {
    const { underInbox, other } = partitionUserFolders([
      label({
        id: "sent",
        name: "Sent",
        imapFolderPath: "INBOX/Sent",
        imapSpecialUse: "\\Sent",
      }),
      label({ id: "work", name: "Work", imapFolderPath: "INBOX/Work" }),
    ]);
    expect(underInbox.map((l) => l.id)).toEqual(["work"]);
    expect(other).toEqual([]);
  });

  it("ignores non-account tag labels", () => {
    const { underInbox, other } = partitionUserFolders([
      label({ id: "tag-1", name: "Priority", type: "user", imapFolderPath: null }),
      label({ id: "folder-1", name: "Work", imapFolderPath: "INBOX/Work" }),
    ]);
    expect(underInbox.map((l) => l.id)).toEqual(["folder-1"]);
    expect(other).toEqual([]);
  });
});
