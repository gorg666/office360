import { useEffect, useState, useCallback, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { AccountSwitcher } from "../accounts/AccountSwitcher";
import { LabelForm } from "../labels/LabelForm";
import { InputDialog } from "../ui/InputDialog";
import { useUIStore } from "@/stores/uiStore";
import { useAccountStore } from "@/stores/accountStore";
import { useLabelStore, type Label } from "@/stores/labelStore";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import { useSmartFolderStore } from "@/stores/smartFolderStore";
import { useActiveLabel, useActiveCategory } from "@/hooks/useRouteNavigation";
import { navigateToLabel } from "@/router/navigate";
import { openNewCompose } from "@/utils/openComposeWindow";
import {
  Settings,
  Plus,
  Tag,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Columns2,
  Bell,
  Users,
  Newspaper,
  Search,
  MailOpen,
  Mail,
  Inbox,
  Paperclip,
  Star,
  Clock,
  FolderSearch,
  Loader2,
  Folder,
  type LucideIcon,
} from "lucide-react";
import {
  buildFolderTree,
  flattenFolderTree,
  partitionUserFolders,
} from "@/services/imap/folderTree";
import { getSetting, setSetting } from "@/services/db/settings";
import {
  FOLDER_EDITING_UNSUPPORTED_MESSAGE,
  supportsFolderEditing,
} from "@/services/email/providerCapabilities";
import { NavBadge } from "./NavBadge";
import { SERVICE_NAV_ICON_SIZE, SERVICE_NAV_REGISTRY } from "./serviceNavRegistry";
import { useServiceNavBadges } from "./useServiceNavBadges";

interface SidebarProps {
  collapsed: boolean;
  onAddAccount: () => void;
}

/** @deprecated Prefer SERVICE_NAV_REGISTRY — kept as alias for existing imports/tests. */
export const ALL_NAV_ITEMS = SERVICE_NAV_REGISTRY.map(({ id, label, icon }) => ({ id, label, icon }));

const CATEGORY_ITEMS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "Primary", label: "Primary", icon: Inbox },
  { id: "Updates", label: "Updates", icon: Bell },
  { id: "Promotions", label: "Promotions", icon: Tag },
  { id: "Social", label: "Social", icon: Users },
  { id: "Newsletters", label: "Newsletters", icon: Newspaper },
];

function DroppableNavItem({
  id,
  isActive,
  collapsed,
  onClick,
  onContextMenu,
  title,
  children,
}: {
  id: string;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  title?: string;
  children: (isOver: boolean) => React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      className={`flex items-center w-full py-2 text-sm transition-colors press-scale ${
        collapsed ? "justify-center px-0" : "gap-3 px-3 text-left"
      } ${
        isOver
          ? "bg-accent/20 ring-1 ring-accent"
          : isActive
            ? "bg-accent/10 text-accent font-medium"
            : "hover:bg-sidebar-hover text-sidebar-text"
      }`}
    >
      {children(isOver)}
    </button>
  );
}

function DroppableLabelItem({
  label,
  isActive,
  collapsed,
  onClick,
  onContextMenu,
  onEditClick,
  canEditFolders,
  depth = 0,
  hasChildren = false,
  expanded = false,
  onToggleExpand,
}: {
  label: Label;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onEditClick: () => void;
  canEditFolders: boolean;
  depth?: number;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: label.id });
  const initial = (label.name[0] ?? "?").toUpperCase();
  const padLeft = collapsed ? undefined : 12 + depth * 12;

  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={collapsed ? label.name : undefined}
      style={padLeft != null ? { paddingLeft: padLeft } : undefined}
      className={`group flex items-center w-full py-2 text-sm transition-colors ${
        collapsed ? "justify-center px-0" : "gap-2 pr-3 text-left"
      } ${
        isOver
          ? "bg-accent/20 ring-1 ring-accent"
          : isActive
            ? "bg-accent/10 text-accent font-medium"
            : "hover:bg-sidebar-hover text-sidebar-text"
      }`}
    >
      {collapsed ? (
        <span
          className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-semibold shrink-0"
          style={label.colorBg
            ? { backgroundColor: label.colorBg, color: label.colorFg ?? "#ffffff" }
            : undefined
          }
        >
          {label.colorBg ? (
            initial
          ) : (
            <Folder size={14} />
          )}
        </span>
      ) : (
        <>
          {hasChildren ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand?.();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleExpand?.();
                }
              }}
              className="p-0.5 text-sidebar-text/50 hover:text-sidebar-text shrink-0"
              title={expanded ? "Collapse" : "Expand"}
            >
              <ChevronRight
                size={12}
                className={`transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            </span>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          {label.colorBg ? (
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: label.colorBg }}
            />
          ) : (
            <Folder size={14} className="shrink-0" />
          )}
          <span className="flex-1 truncate">{label.name}</span>
          {canEditFolders && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onEditClick(); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onEditClick(); } }}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-sidebar-text/40 hover:text-sidebar-text transition-opacity"
              title="Edit label"
            >
              <Pencil size={12} />
            </span>
          )}
        </>
      )}
    </button>
  );
}

const SMART_FOLDER_ICON_MAP: Record<string, LucideIcon> = {
  Search,
  MailOpen,
  Paperclip,
  Star,
  FolderSearch,
  Inbox,
  Clock,
  Tag,
};

function getSmartFolderIcon(iconName: string): LucideIcon {
  return SMART_FOLDER_ICON_MAP[iconName] ?? Search;
}

const LABELS_COLLAPSED_COUNT = 3;
const SERVICE_NAV_IDS = new Set([
  "messengers", "tasks", "calendar", "attachments", "disk", "telemost", "tracker",
]);

export function Sidebar({ collapsed, onAddAccount }: SidebarProps) {
  const activeLabel = useActiveLabel();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const sidebarNavConfig = useUIStore((s) => s.sidebarNavConfig);
  const inboxViewMode = useUIStore((s) => s.inboxViewMode);
  const setInboxViewMode = useUIStore((s) => s.setInboxViewMode);
  const messengersPanelsOpen = useUIStore((s) => s.messengersPanelsOpen);
  const setMessengersPanelsOpen = useUIStore((s) => s.setMessengersPanelsOpen);
  const activeCategory = useActiveCategory();
  const openComposer = useCallback(() => {
    void openNewCompose();
  }, []);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const activeAccount = useAccountStore((s) =>
    s.accounts.find((account) => account.id === s.activeAccountId),
  );
  const { getBadgeCount } = useServiceNavBadges(activeAccountId);
  const canEditFolders = supportsFolderEditing(activeAccount?.provider);
  const labels = useLabelStore((s) => s.labels);
  const loadLabels = useLabelStore((s) => s.loadLabels);
  const deleteLabel = useLabelStore((s) => s.deleteLabel);
  const smartFolders = useSmartFolderStore((s) => s.folders);
  const smartFolderCounts = useSmartFolderStore((s) => s.unreadCounts);
  const loadSmartFolders = useSmartFolderStore((s) => s.loadFolders);
  const refreshSmartFolderCounts = useSmartFolderStore((s) => s.refreshUnreadCounts);
  const createSmartFolder = useSmartFolderStore((s) => s.createFolder);
  const SECTION_IDS = new Set(["smart-folders", "labels"]);

  const { visibleNavItems, showSmartFolders, showLabels } = useMemo(() => {
    if (!sidebarNavConfig) {
      const navOnly = ALL_NAV_ITEMS.filter((i) => !SECTION_IDS.has(i.id));
      return { visibleNavItems: navOnly, showSmartFolders: true, showLabels: true };
    }
    const itemMap = new Map(ALL_NAV_ITEMS.map((item) => [item.id, item]));
    const result: typeof ALL_NAV_ITEMS = [];
    const seen = new Set<string>();
    let smartFoldersVisible = true;
    let labelsVisible = true;
    for (const entry of sidebarNavConfig) {
      seen.add(entry.id);
      if (entry.id === "smart-folders") { smartFoldersVisible = entry.visible; continue; }
      if (entry.id === "labels") { labelsVisible = entry.visible; continue; }
      if (entry.visible && itemMap.has(entry.id)) {
        result.push(itemMap.get(entry.id)!);
      }
    }
    // Append any new items not present in the saved config
    for (const item of ALL_NAV_ITEMS) {
      if (!seen.has(item.id) && !SECTION_IDS.has(item.id)) result.push(item);
    }
    return { visibleNavItems: result, showSmartFolders: smartFoldersVisible, showLabels: labelsVisible };
  }, [sidebarNavConfig]);

  const [labelsExpanded, setLabelsExpanded] = useState(false);
  const [folderExpandedKeys, setFolderExpandedKeys] = useState<Set<string>>(() => new Set());
  const [inboxChildrenExpanded, setInboxChildrenExpanded] = useState(true);

  const { underInboxLabels, otherFolderLabels, tagLabels } = useMemo(() => {
    const { underInbox, other } = partitionUserFolders(labels);
    const accountIds = new Set(
      labels
        .filter((l) => !!l.imapFolderPath || l.id.startsWith("folder-"))
        .map((l) => l.id),
    );
    const tags = labels.filter((l) => !accountIds.has(l.id));
    return {
      underInboxLabels: underInbox,
      otherFolderLabels: other,
      tagLabels: tags,
    };
  }, [labels]);

  const underInboxFlat = useMemo(() => {
    const tree = buildFolderTree(underInboxLabels);
    return flattenFolderTree(tree, folderExpandedKeys);
  }, [underInboxLabels, folderExpandedKeys]);

  const otherFoldersFlat = useMemo(() => {
    const tree = buildFolderTree(otherFolderLabels);
    return flattenFolderTree(tree, folderExpandedKeys);
  }, [otherFolderLabels, folderExpandedKeys]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await getSetting("mail.folderTree.expanded");
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as { keys?: string[]; inboxChildren?: boolean };
        if (Array.isArray(parsed.keys)) {
          setFolderExpandedKeys(new Set(parsed.keys));
        }
        if (typeof parsed.inboxChildren === "boolean") {
          setInboxChildrenExpanded(parsed.inboxChildren);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAccountId]);

  const persistFolderExpanded = useCallback(
    (keys: Set<string>, inboxChildren: boolean) => {
      void setSetting(
        "mail.folderTree.expanded",
        JSON.stringify({ keys: [...keys], inboxChildren }),
      );
    },
    [],
  );

  const toggleFolderExpanded = useCallback(
    (pathKey: string) => {
      setFolderExpandedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(pathKey)) next.delete(pathKey);
        else next.add(pathKey);
        persistFolderExpanded(next, inboxChildrenExpanded);
        return next;
      });
    },
    [inboxChildrenExpanded, persistFolderExpanded],
  );

  // Inline label editing state
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [showNewLabelForm, setShowNewLabelForm] = useState(false);

  const openMenu = useContextMenuStore((s) => s.openMenu);
  const isSyncingFolder = useUIStore((s) => s.isSyncingFolder);

  const handleNavContextMenu = useCallback((e: React.MouseEvent, navId: string) => {
    e.preventDefault();
    openMenu("sidebarNav", { x: e.clientX, y: e.clientY }, { navId });
  }, [openMenu]);

  // Load labels when active account changes
  useEffect(() => {
    if (activeAccountId) {
      loadLabels(activeAccountId);
    }
  }, [activeAccountId, loadLabels]);

  // Load smart folders when active account changes
  useEffect(() => {
    loadSmartFolders(activeAccountId ?? undefined);
    if (activeAccountId) {
      refreshSmartFolderCounts(activeAccountId);
    }
  }, [activeAccountId, loadSmartFolders, refreshSmartFolderCounts]);

  // Reload labels and smart folder counts on sync completion (debounced to avoid waterfall from multiple emitters)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (activeAccountId) {
          loadLabels(activeAccountId);
          refreshSmartFolderCounts(activeAccountId);
        }
        useUIStore.getState().setSyncingFolder(null);
      }, 500);
    };
    window.addEventListener("velo-sync-done", handler);
    return () => {
      window.removeEventListener("velo-sync-done", handler);
      if (timer) clearTimeout(timer);
    };
  }, [activeAccountId, loadLabels, refreshSmartFolderCounts]);

  const handleDeleteLabel = useCallback(async (labelId: string) => {
    if (!activeAccountId || !canEditFolders) return;
    try {
      await deleteLabel(activeAccountId, labelId);
      if (editingLabelId === labelId) setEditingLabelId(null);
    } catch {
      // Silently fail in sidebar — user can use Settings for detailed errors
    }
  }, [activeAccountId, canEditFolders, deleteLabel, editingLabelId]);

  const handleFormDone = useCallback(() => {
    setEditingLabelId(null);
    setShowNewLabelForm(false);
  }, []);

  const handleEditLabel = useCallback((labelId: string) => {
    if (!canEditFolders) return;
    setShowNewLabelForm(false);
    setEditingLabelId(labelId);
  }, [canEditFolders]);

  const handleLabelContextMenu = useCallback((e: React.MouseEvent, labelId: string) => {
    e.preventDefault();
    openMenu("sidebarLabel", { x: e.clientX, y: e.clientY }, {
      labelId,
      onEdit: () => handleEditLabel(labelId),
      onDelete: () => handleDeleteLabel(labelId),
    });
  }, [openMenu, handleEditLabel, handleDeleteLabel]);

  const handleAddLabel = useCallback(() => {
    if (!canEditFolders) return;
    setEditingLabelId(null);
    setShowNewLabelForm(true);
  }, [canEditFolders]);

  useEffect(() => {
    if (!canEditFolders) handleFormDone();
  }, [canEditFolders, handleFormDone]);

  const [showSmartFolderModal, setShowSmartFolderModal] = useState(false);

  const handleAddSmartFolder = useCallback(() => {
    setShowSmartFolderModal(true);
  }, []);

  const editingLabel = editingLabelId ? labels.find((l) => l.id === editingLabelId) ?? null : null;

  return (
    <aside
      className={`no-select flex flex-col bg-sidebar-bg text-sidebar-text border-r border-border-primary transition-all duration-200 glass-panel ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      {/* Compose button */}
      <div className="px-0 py-0">
        <button
          onClick={() => openComposer()}
          className={`w-full flex items-center text-sidebar-text hover:bg-sidebar-hover transition-colors press-scale ${
            collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-4 py-3 text-left"
          }`}
        >
          {collapsed ? (
            <Plus size={18} />
          ) : (
            <>
              <Mail size={18} className="shrink-0" />
              <span className="text-base font-medium">Новое письмо</span>
            </>
          )}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto pt-0 pb-2">
        {visibleNavItems.map((item, index) => {
          const Icon = item.icon;
          const isInbox = item.id === "inbox";
          const previousItem = visibleNavItems[index - 1];
          const shouldShowServicesHeader = !collapsed
            && SERVICE_NAV_IDS.has(item.id)
            && (!previousItem || !SERVICE_NAV_IDS.has(previousItem.id));
          const registryItem = SERVICE_NAV_REGISTRY.find((entry) => entry.id === item.id);
          const badgeCount = registryItem ? getBadgeCount(registryItem.badgeSource) : 0;
          const badgeTitle = collapsed && badgeCount > 0 ? `${item.label}: ${badgeCount > 99 ? "99+" : badgeCount}` : undefined;
          return (
            <div key={item.id}>
              {shouldShowServicesHeader && (
                <div className="flex items-center justify-between px-3 pt-4 pb-1">
                  <span className="text-xs font-medium text-sidebar-text/60 uppercase tracking-wider">
                    Сервисы
                  </span>
                </div>
              )}
              <DroppableNavItem
                id={item.id}
                isActive={
                  item.id === "messengers"
                    ? messengersPanelsOpen
                    : isInbox
                      ? (activeLabel === "inbox" && (inboxViewMode === "unified" || activeCategory === "Primary"))
                      : activeLabel === item.id
                }
                collapsed={collapsed}
                onClick={() => {
                  if (item.id === "messengers") {
                    if (messengersPanelsOpen) {
                      setMessengersPanelsOpen(false);
                    } else {
                      navigateToLabel("messengers");
                    }
                    return;
                  }
                  if (isInbox && inboxViewMode === "split") {
                    navigateToLabel(item.id, { category: "Primary" });
                  } else {
                    navigateToLabel(item.id);
                  }
                }}
                onContextMenu={(e) => handleNavContextMenu(e, item.id)}
                title={collapsed ? (badgeTitle ?? item.label) : undefined}
              >
                {() => (
                  <>
                    {isSyncingFolder === item.id ? (
                      <Loader2 size={SERVICE_NAV_ICON_SIZE} className="shrink-0 animate-spin text-accent" aria-hidden />
                    ) : (
                      <Icon size={SERVICE_NAV_ICON_SIZE} className="shrink-0 text-current" aria-hidden />
                    )}
                    {!collapsed && (
                      <span className="flex-1 truncate">{item.label}</span>
                    )}
                    {registryItem && (
                      <NavBadge count={badgeCount} label={item.label} collapsed={collapsed} />
                    )}
                    {isInbox && !collapsed && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setInboxViewMode(inboxViewMode === "split" ? "unified" : "split");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            setInboxViewMode(inboxViewMode === "split" ? "unified" : "split");
                          }
                        }}
                        title={inboxViewMode === "split" ? "Единый входящий" : "Разделённый входящий"}
                        className={`p-1 rounded transition-colors ${
                          inboxViewMode === "split"
                            ? "text-accent hover:bg-accent/10"
                            : "text-sidebar-text/40 hover:text-sidebar-text hover:bg-sidebar-hover"
                        }`}
                      >
                        <Columns2 size={14} />
                      </span>
                    )}
                  </>
                )}
              </DroppableNavItem>
              {/* Category sub-items when split mode is active */}
              {isInbox && inboxViewMode === "split" && !collapsed && (
                <div>
                  {CATEGORY_ITEMS.map((cat) => {
                    const CatIcon = cat.icon;
                    const isCatActive = activeLabel === "inbox" && activeCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => {
                          navigateToLabel("inbox", { category: cat.id });
                        }}
                        className={`flex items-center gap-2 w-full py-1.5 pl-7 pr-3 text-left text-[0.8125rem] transition-colors ${
                          isCatActive
                            ? "text-accent font-medium"
                            : "text-sidebar-text/70 hover:text-sidebar-text hover:bg-sidebar-hover"
                        }`}
                      >
                        <CatIcon size={14} className="shrink-0" />
                        <span className="flex-1 truncate">{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {isInbox && !collapsed && underInboxLabels.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setInboxChildrenExpanded((prev) => {
                        const next = !prev;
                        persistFolderExpanded(folderExpandedKeys, next);
                        return next;
                      });
                    }}
                    className="flex items-center gap-1 w-full px-3 py-1 text-[0.6875rem] text-sidebar-text/50 hover:text-sidebar-text"
                  >
                    <ChevronRight
                      size={12}
                      className={`transition-transform ${inboxChildrenExpanded ? "rotate-90" : ""}`}
                    />
                    <span>Папки аккаунта</span>
                  </button>
                  {inboxChildrenExpanded &&
                    underInboxFlat.map((node) => (
                      <div key={node.label.id}>
                        <DroppableLabelItem
                          label={node.label}
                          isActive={activeLabel === node.label.id}
                          collapsed={collapsed}
                          depth={node.depth + 1}
                          hasChildren={node.children.length > 0}
                          expanded={folderExpandedKeys.has(node.pathKey)}
                          onToggleExpand={() => toggleFolderExpanded(node.pathKey)}
                          onClick={() => navigateToLabel(node.label.id)}
                          onContextMenu={(e) => handleLabelContextMenu(e, node.label.id)}
                          onEditClick={() => handleEditLabel(node.label.id)}
                          canEditFolders={canEditFolders}
                        />
                        {editingLabelId === node.label.id && activeAccountId && (
                          <LabelForm
                            accountId={activeAccountId}
                            label={editingLabel}
                            onDone={handleFormDone}
                            variant="sidebar"
                          />
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Other account IMAP folders (not Inbox children, not SPECIAL-USE system) */}
        {!collapsed && otherFoldersFlat.length > 0 && (
          <div className="pt-2">
            {!collapsed && (
            <div className="px-3 pb-1 text-[0.6875rem] text-sidebar-text/50">Folders</div>
            )}
            {otherFoldersFlat.map((node) => (
              <div key={node.label.id}>
                <DroppableLabelItem
                  label={node.label}
                  isActive={activeLabel === node.label.id}
                  collapsed={collapsed}
                  depth={node.depth}
                  hasChildren={node.children.length > 0}
                  expanded={folderExpandedKeys.has(node.pathKey)}
                  onToggleExpand={() => toggleFolderExpanded(node.pathKey)}
                  onClick={() => navigateToLabel(node.label.id)}
                  onContextMenu={(e) => handleLabelContextMenu(e, node.label.id)}
                  onEditClick={() => handleEditLabel(node.label.id)}
                  canEditFolders={canEditFolders}
                />
              </div>
            ))}
          </div>
        )}

        {/* Smart Folders */}
        {showSmartFolders && (smartFolders.length > 0 || !collapsed) && (
          <>
            {!collapsed && (
              <div className="flex items-center justify-between px-3 pt-4 pb-1">
                <span className="text-xs font-medium text-sidebar-text/60 uppercase tracking-wider">
                  Smart Folders
                </span>
                <button
                  onClick={handleAddSmartFolder}
                  className="p-0.5 text-sidebar-text/40 hover:text-sidebar-text transition-colors"
                  title="Add smart folder"
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
            {smartFolders.map((folder) => {
              const Icon = getSmartFolderIcon(folder.icon);
              const isActive = activeLabel === `smart-folder:${folder.id}`;
              const count = smartFolderCounts[folder.id] ?? 0;
              return (
                <button
                  key={folder.id}
                  onClick={() => navigateToLabel(`smart-folder:${folder.id}`)}
                  title={collapsed ? folder.name : undefined}
                  className={`flex items-center w-full py-2 text-sm transition-colors press-scale ${
                    collapsed ? "justify-center px-0" : "gap-3 px-3 text-left"
                  } ${
                    isActive
                      ? "bg-accent/10 text-accent font-medium"
                      : "hover:bg-sidebar-hover text-sidebar-text"
                  }`}
                >
                  <Icon
                    size={18}
                    className="shrink-0"
                    style={folder.color ? { color: folder.color } : undefined}
                  />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate">{folder.name}</span>
                      {count > 0 && (
                        <span className="text-[0.625rem] bg-accent/15 text-accent px-1.5 rounded-full leading-normal">
                          {count}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </>
        )}

        {/* User labels (Gmail-style tags only — IMAP folders live under Inbox / Folders) */}
        {showLabels && (tagLabels.length > 0 || showNewLabelForm) && (
          <>
            {!collapsed && (
              <div className="flex items-center justify-between px-3 pt-4 pb-1">
                <span className="text-xs font-medium text-sidebar-text/60 uppercase tracking-wider">
                  Labels
                </span>
                <button
                  onClick={handleAddLabel}
                  disabled={!canEditFolders}
                  className="p-0.5 text-sidebar-text/40 hover:text-sidebar-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-sidebar-text/40"
                  title={canEditFolders ? "Add label" : FOLDER_EDITING_UNSUPPORTED_MESSAGE}
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
            {/* Always-visible labels */}
            {tagLabels.slice(0, LABELS_COLLAPSED_COUNT).map((label) => (
              <div key={label.id}>
                <DroppableLabelItem
                  label={label}
                  isActive={activeLabel === label.id}
                  collapsed={collapsed}
                  onClick={() => navigateToLabel(label.id)}
                  onContextMenu={(e) => handleLabelContextMenu(e, label.id)}
                  onEditClick={() => handleEditLabel(label.id)}
                  canEditFolders={canEditFolders}
                />
                {editingLabelId === label.id && activeAccountId && !collapsed && (
                  <LabelForm
                    accountId={activeAccountId}
                    label={editingLabel}
                    onDone={handleFormDone}
                    variant="sidebar"
                  />
                )}
              </div>
            ))}
            {/* Collapsible labels with accordion animation */}
            {tagLabels.length > LABELS_COLLAPSED_COUNT && (
              <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${labelsExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                <div className="overflow-hidden">
                  {tagLabels.slice(LABELS_COLLAPSED_COUNT).map((label) => (
                    <div key={label.id}>
                      <DroppableLabelItem
                        label={label}
                        isActive={activeLabel === label.id}
                        collapsed={collapsed}
                        onClick={() => navigateToLabel(label.id)}
                        onContextMenu={(e) => handleLabelContextMenu(e, label.id)}
                        onEditClick={() => handleEditLabel(label.id)}
                        canEditFolders={canEditFolders}
                      />
                      {editingLabelId === label.id && activeAccountId && !collapsed && (
                        <LabelForm
                          accountId={activeAccountId}
                          label={editingLabel}
                          onDone={handleFormDone}
                          variant="sidebar"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!collapsed && tagLabels.length > LABELS_COLLAPSED_COUNT && (
              <button
                onClick={() => setLabelsExpanded((v) => !v)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-sidebar-text/60 hover:text-sidebar-text transition-colors"
              >
                {labelsExpanded ? (
                  <>
                    <ChevronUp size={12} />
                    <span>Show less</span>
                  </>
                ) : (
                  <>
                    <ChevronDown size={12} />
                    <span>Show {tagLabels.length - LABELS_COLLAPSED_COUNT} more</span>
                  </>
                )}
              </button>
            )}
            {/* New label form at bottom of list */}
            {showNewLabelForm && activeAccountId && !collapsed && (
              <LabelForm
                accountId={activeAccountId}
                onDone={handleFormDone}
                variant="sidebar"
              />
            )}
          </>
        )}
      </nav>

      <div className="border-t border-border-primary pt-1">
        <AccountSwitcher
          collapsed={collapsed}
          onAddAccount={onAddAccount}
          dropdownPlacement="up"
        />
      </div>

      {/* Bottom bar: Settings + collapse toggle */}
      <div className={`pb-2 flex ${collapsed ? "flex-col items-center gap-1 px-2" : "items-center gap-1 px-3"}`}>
        <button
          onClick={() => navigateToLabel("settings")}
          className={`flex items-center text-sm rounded-md transition-colors ${
            collapsed ? "p-2 justify-center" : "gap-3 flex-1 px-3 py-2 text-left"
          } ${
            activeLabel === "settings"
              ? "bg-accent/10 text-accent font-medium"
              : "text-sidebar-text hover:bg-sidebar-hover"
          }`}
          title="Settings"
        >
          <Settings size={18} className="shrink-0" />
          {!collapsed && <span>Settings</span>}
        </button>
        <button
          onClick={() => navigateToLabel("help")}
          className={`flex items-center text-sm rounded-md transition-colors ${
            collapsed ? "p-2 justify-center" : "p-2"
          } ${
            activeLabel === "help"
              ? "bg-accent/10 text-accent font-medium"
              : "text-sidebar-text hover:bg-sidebar-hover"
          }`}
          title="Help"
        >
          <HelpCircle size={18} className="shrink-0" />
        </button>
        <button
          onClick={toggleSidebar}
          className="p-2 text-sidebar-text/60 hover:text-sidebar-text hover:bg-sidebar-hover rounded-md transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <InputDialog
        isOpen={showSmartFolderModal}
        onClose={() => setShowSmartFolderModal(false)}
        onSubmit={(values) => {
          createSmartFolder(
            values.name!.trim(),
            values.query!.trim(),
            activeAccountId ?? undefined,
          );
        }}
        title="New Smart Folder"
        fields={[
          { key: "name", label: "Name", placeholder: "e.g. Unread from boss" },
          { key: "query", label: "Search query", placeholder: "e.g. is:unread from:boss" },
        ]}
      />

      {/* Pending operations indicator */}
      <PendingOpsIndicator collapsed={collapsed} />
    </aside>
  );
}

function PendingOpsIndicator({ collapsed }: { collapsed: boolean }) {
  const pendingOpsCount = useUIStore((s) => s.pendingOpsCount);
  if (pendingOpsCount <= 0) return null;

  return (
    <div className="px-3 py-2 border-t border-border-primary">
      {collapsed ? (
        <div className="flex justify-center">
          <span className="bg-accent/20 text-accent text-xs font-medium px-1.5 py-0.5 rounded-full">{pendingOpsCount}</span>
        </div>
      ) : (
        <div className="text-xs text-text-secondary">
          В очереди операций: {pendingOpsCount}
        </div>
      )}
    </div>
  );
}
