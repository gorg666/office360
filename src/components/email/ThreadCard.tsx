import { memo, useEffect, useMemo, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Thread } from "@/stores/threadStore";
import { useThreadStore } from "@/stores/threadStore";
import { useUIStore } from "@/stores/uiStore";
import { useActiveLabel } from "@/hooks/useRouteNavigation";
import { formatRelativeDate } from "@/utils/date";
import { Paperclip, Star, Check, Pin, BellRing, VolumeX } from "lucide-react";
import type { DragData } from "@/components/dnd/DndProvider";
import { densityPadding, threadRowVisual } from "./threadRowVisual";
import { ContactAvatar } from "@/components/ui/ContactAvatar";

const CATEGORY_COLORS: Record<string, string> = {
  Updates: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  Promotions: "bg-green-500/15 text-green-600 dark:text-green-400",
  Social: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  Newsletters: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
};

interface ThreadCardProps {
  thread: Thread;
  isSelected: boolean;
  onClick: (thread: Thread) => void;
  onDoubleClick?: (thread: Thread) => void;
  onContextMenu?: (e: React.MouseEvent, threadId: string) => void;
  category?: string;
  showCategoryBadge?: boolean;
  hasFollowUp?: boolean;
}

const SINGLE_CLICK_DELAY_MS = 250;

export const ThreadCard = memo(function ThreadCard({
  thread,
  isSelected,
  onClick,
  onDoubleClick,
  onContextMenu,
  category,
  showCategoryBadge,
  hasFollowUp,
}: ThreadCardProps) {
  const isMultiSelected = useThreadStore((s) => s.selectedThreadIds.has(thread.id));
  const hasMultiSelect = useThreadStore((s) => s.selectedThreadIds.size > 0);
  const toggleThreadSelection = useThreadStore((s) => s.toggleThreadSelection);
  const selectThreadRange = useThreadStore((s) => s.selectThreadRange);
  const activeLabel = useActiveLabel();
  const emailDensity = useUIStore((s) => s.emailDensity);
  const isSpam = thread.labelIds.includes("SPAM");

  // Read selectedThreadIds lazily for drag — avoids subscribing all cards to the Set reference
  const dragData: DragData = useMemo(() => ({
    threadIds: hasMultiSelect && isMultiSelected
      ? [...useThreadStore.getState().selectedThreadIds]
      : [thread.id],
    sourceLabel: activeLabel,
  }), [hasMultiSelect, isMultiSelected, thread.id, activeLabel]);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `thread-${thread.id}`,
    data: dragData,
  });

  const singleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (singleClickTimerRef.current) {
        clearTimeout(singleClickTimerRef.current);
      }
    };
  }, []);

  const runSingleClickAction = () => {
    onClick(thread);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      selectThreadRange(thread.id);
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggleThreadSelection(thread.id);
    } else if (hasMultiSelect) {
      toggleThreadSelection(thread.id);
    } else if (onDoubleClick) {
      if (singleClickTimerRef.current) {
        clearTimeout(singleClickTimerRef.current);
      }
      singleClickTimerRef.current = setTimeout(() => {
        singleClickTimerRef.current = null;
        runSingleClickAction();
      }, SINGLE_CLICK_DELAY_MS);
    } else {
      runSingleClickAction();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!onDoubleClick) return;
    e.preventDefault();
    e.stopPropagation();
    if (singleClickTimerRef.current) {
      clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = null;
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey || hasMultiSelect) return;
    onDoubleClick(thread);
  };

  const handleContextMenu = onContextMenu
    ? (e: React.MouseEvent) => onContextMenu(e, thread.id)
    : undefined;
  const avatarClassName = emailDensity === "compact"
    ? "w-7 h-7 rounded-full shrink-0"
    : emailDensity === "spacious"
      ? "w-10 h-10 rounded-full shrink-0"
      : "w-9 h-9 rounded-full shrink-0";
  const avatarTextClassName = emailDensity === "compact" ? "text-xs" : "text-sm";

  const rowVisual = threadRowVisual({
    isRead: thread.isRead,
    isSelected,
    isMultiSelected,
    isDragging,
    isSpam,
  });

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      aria-label={`${thread.isRead ? "" : "Unread "}email from ${thread.fromName ?? thread.fromAddress ?? "Unknown"}: ${thread.subject ?? "(No subject)"}`}
      aria-selected={isSelected}
      className={`focus-ring-inset group relative w-full border-b border-hairline text-left t-fast ${densityPadding(emailDensity)} ${rowVisual.row}`}
      data-office360-context-menu-source
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        {isMultiSelected ? (
          <div className={`${avatarClassName} flex items-center justify-center bg-brand text-brand-contrast`}>
            <Check size={emailDensity === "compact" ? 14 : 16} />
          </div>
        ) : (
          <ContactAvatar
            email={thread.fromAddress}
            name={thread.fromName}
            className={avatarClassName}
            textClassName={avatarTextClassName}
            fallbackClassName={thread.isRead ? "bg-surface-sunken text-ink-secondary" : "bg-brand text-brand-contrast"}
            lookupExternalAvatar
          />
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* First row: sender + date */}
          <div className="relative flex items-center gap-2">
            {!thread.isRead && (
              <span
                className="absolute -left-2.5 h-1.5 w-1.5 rounded-full bg-brand"
                aria-hidden
                title="Unread"
              />
            )}
            <span
              className={`min-w-0 flex-1 truncate text-left text-meta ${rowVisual.sender}`}
            >
              {thread.fromName ?? thread.fromAddress ?? "Unknown"}
            </span>
            <span className="shrink-0 whitespace-nowrap text-caption tabular-nums text-ink-tertiary">
              {formatRelativeDate(thread.lastMessageAt)}
            </span>
          </div>

          {/* Subject */}
          <div
            className={`mt-0.5 truncate text-copy ${rowVisual.subject}`}
          >
            {thread.subject ?? "(No subject)"}
          </div>

          {/* Snippet + indicators */}
          <div className={`flex items-center gap-1.5 mt-0.5 ${emailDensity === "compact" ? "hidden" : ""}`}>
            <span className="flex-1 truncate text-caption text-ink-tertiary">
              {thread.snippet}
            </span>
            {showCategoryBadge && category && category !== "Primary" && CATEGORY_COLORS[category] && (
              <span className={`shrink-0 rounded-full px-1.5 text-caption leading-normal ${CATEGORY_COLORS[category]}`}>
                {category}
              </span>
            )}
            {hasFollowUp && (
              <span className="shrink-0 text-brand-text" title="Follow-up reminder set">
                <BellRing size={12} />
              </span>
            )}
            {thread.isMuted && (
              <span className="shrink-0 text-warning-text" title="Muted">
                <VolumeX size={12} />
              </span>
            )}
            {thread.isPinned && (
              <span className="shrink-0 text-brand-text" title="Pinned">
                <Pin size={12} className="fill-current" />
              </span>
            )}
            {thread.hasAttachments && (
              <span className="shrink-0 text-ink-tertiary" title="Has attachments">
                <Paperclip size={12} />
              </span>
            )}
            {thread.isStarred && (
              <span className="star-animate shrink-0 text-warning-text" title="Starred">
                <Star size={12} className="fill-current" />
              </span>
            )}
            {thread.messageCount > 1 && (
              <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 text-caption text-ink-tertiary">
                {thread.messageCount}
              </span>
            )}
          </div>
        </div>
      </div>

    </button>
  );
});
