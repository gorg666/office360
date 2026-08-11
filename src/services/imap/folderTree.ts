import type { Label } from "@/stores/labelStore";

export interface FolderTreeNode {
  label: Label;
  children: FolderTreeNode[];
  depth: number;
  pathKey: string;
}

function pathOf(label: Label): string {
  return (label.imapFolderPath ?? label.name).replace(/^\/+|\/+$/g, "");
}

function delimiterOf(label: Label): string {
  const path = pathOf(label);
  if (path.includes("/")) return "/";
  if (path.includes(".")) return ".";
  return "/";
}

/** True when IMAP path is a child of Inbox (not Inbox itself). */
export function isInboxChildPath(path: string, delimiter = "/"): boolean {
  const lower = path.toLowerCase();
  const prefixes = [`inbox${delimiter}`, `входящие${delimiter}`];
  return prefixes.some((p) => lower.startsWith(p));
}

/**
 * Build a collapsible tree from user IMAP folders using path + delimiter.
 * SPECIAL-USE system folders must already be filtered out by the caller.
 */
export function buildFolderTree(labels: Label[]): FolderTreeNode[] {
  if (labels.length === 0) return [];

  const nodes = new Map<string, FolderTreeNode>();
  const sorted = [...labels].sort((a, b) => pathOf(a).localeCompare(pathOf(b)));

  for (const label of sorted) {
    const pathKey = pathOf(label);
    nodes.set(pathKey, {
      label,
      children: [],
      depth: 0,
      pathKey,
    });
  }

  const roots: FolderTreeNode[] = [];

  for (const node of nodes.values()) {
    const delim = delimiterOf(node.label);
    const parts = node.pathKey.split(delim).filter(Boolean);
    if (parts.length <= 1) {
      roots.push(node);
      continue;
    }
    const parentKey = parts.slice(0, -1).join(delim);
    const parent = nodes.get(parentKey);
    if (parent) {
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const assignDepth = (list: FolderTreeNode[], depth: number) => {
    for (const n of list) {
      n.depth = depth;
      assignDepth(n.children, depth + 1);
    }
  };
  assignDepth(roots, 0);
  return roots;
}

/** Flatten tree for rendering with optional expanded set. */
export function flattenFolderTree(
  roots: FolderTreeNode[],
  expanded: Set<string>,
): FolderTreeNode[] {
  const out: FolderTreeNode[] = [];
  const walk = (nodes: FolderTreeNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children.length > 0 && expanded.has(n.pathKey)) {
        walk(n.children);
      }
    }
  };
  walk(roots);
  return out;
}

/** SPECIAL-USE roles already covered by system nav — never nest under Inbox. */
const SYSTEM_SPECIAL_USE = new Set([
  "\\inbox",
  "\\sent",
  "\\trash",
  "\\drafts",
  "\\junk",
  "\\spam",
  "\\archive",
  "\\all",
  "\\flagged",
]);

export function isSpecialUseSystemFolder(label: Label): boolean {
  const raw = (label.imapSpecialUse ?? "").trim().toLowerCase();
  if (!raw) return false;
  return raw.split(/\s+/).some((token) => SYSTEM_SPECIAL_USE.has(token));
}

/** Account IMAP folders (not Gmail-style tags without IMAP path). */
export function isAccountImapFolder(label: Label): boolean {
  return !!label.imapFolderPath || label.id.startsWith("folder-");
}

/** Split user folders into Inbox children vs other mailbox folders. */
export function partitionUserFolders(labels: Label[]): {
  underInbox: Label[];
  other: Label[];
} {
  const underInbox: Label[] = [];
  const other: Label[] = [];
  for (const label of labels) {
    if (!isAccountImapFolder(label)) continue;
    // Do not place SPECIAL-USE Sent/Trash/Drafts under Inbox tree.
    if (isSpecialUseSystemFolder(label)) continue;
    const path = pathOf(label);
    const delim = delimiterOf(label);
    if (isInboxChildPath(path, delim)) {
      underInbox.push(label);
    } else {
      other.push(label);
    }
  }
  return { underInbox, other };
}
