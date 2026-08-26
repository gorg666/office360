/**
 * Message-row presentation model — DESIGN-001D.
 *
 * The row's visual states used to live inline in ThreadCard, with a test file
 * that re-declared them ("helpers mirroring ThreadCard's rules") and could
 * therefore drift from the component without failing. This is the real thing:
 * ThreadCard consumes it, and the tests test it.
 *
 * Pure — no React, no styling side effects — so the state precedence is
 * assertable rather than inferred from a rendered DOM.
 *
 * Precedence, highest first: dragging > multi-selected > selected > unread > read.
 * Spam is an independent overlay: a thread can be spam in any of those states.
 */

// Re-uses the store's type rather than redeclaring it: a local copy would
// drift the moment a density is added or renamed.
import type { EmailDensity } from "@/stores/uiStore";

export interface ThreadRowState {
  isRead: boolean;
  isSelected: boolean;
  isMultiSelected: boolean;
  isDragging: boolean;
  isSpam: boolean;
}

export interface ThreadRowVisual {
  /** Background + left marker for the row container. */
  row: string;
  /** Sender line. */
  sender: string;
  /** Subject line. */
  subject: string;
  /** Snippet line. */
  snippet: string;
  /** Whether to render the unread dot. */
  showDot: boolean;
}

/** Row padding per density. Compact is the desktop default for dense mail. */
export function densityPadding(density: EmailDensity): string {
  if (density === "compact") return "px-3 py-1.5";
  if (density === "spacious") return "px-4 py-3.5";
  return "px-4 py-2.5";
}

/**
 * The left marker is drawn with ::before so it needs no extra element and
 * cannot disturb the row's flex layout.
 */
const MARKER = "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-brand";

export function threadRowVisual(state: ThreadRowState): ThreadRowVisual {
  const { isRead, isSelected, isMultiSelected, isDragging, isSpam } = state;

  let row: string;
  if (isDragging) {
    row = "opacity-50";
  } else if (isMultiSelected) {
    row = `bg-brand-tint-2 ${MARKER}`;
  } else if (isSelected) {
    row = `bg-brand-tint-2 ${MARKER}`;
  } else if (!isRead) {
    // Unread needs a tint you can actually see. The previous bg-accent/[0.04]
    // was 4% of a grey accent — visually nothing.
    row = "bg-brand-tint-1 hover:bg-brand-tint-2";
  } else {
    row = "hover:bg-surface-sunken";
  }

  if (isSpam && !isDragging) {
    row += " bg-danger-surface";
  }

  const emphasised = !isRead || isSelected || isMultiSelected;

  return {
    row,
    sender: emphasised
      ? "font-semibold text-ink-primary"
      : "font-normal text-ink-secondary",
    subject: emphasised
      ? "font-semibold text-ink-primary"
      : "font-normal text-ink-secondary",
    snippet: "text-ink-tertiary",
    showDot: !isRead,
  };
}
