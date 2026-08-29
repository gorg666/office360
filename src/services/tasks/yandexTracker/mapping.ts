import type { TaskPriority, TaskStatus } from "../domain";
import type { TrackerRef } from "@/services/yandex/trackerClient";

const PRIORITY_MAP: Record<string, TaskPriority> = {
  blocker: "critical",
  critical: "critical",
  urgent: "critical",
  high: "high",
  major: "high",
  normal: "normal",
  medium: "normal",
  average: "normal",
  low: "low",
  minor: "low",
  trivial: "low",
};

const STATUS_TYPE_MAP: Record<string, TaskStatus> = {
  new: "open",
  open: "open",
  inprogress: "in_progress",
  in_progress: "in_progress",
  paused: "in_progress",
  needinfo: "in_progress",
  resolved: "done",
  closed: "done",
  done: "done",
  cancelled: "cancelled",
  canceled: "cancelled",
};

export function mapTrackerPriority(ref?: TrackerRef | null): {
  priority: TaskPriority;
  providerPriority: string | null;
} {
  const raw = (ref?.key ?? ref?.id ?? ref?.display ?? "").trim();
  if (!raw) return { priority: "unknown", providerPriority: null };
  const normalized = PRIORITY_MAP[raw.toLowerCase().replace(/[\s-]/g, "")];
  return {
    priority: normalized ?? "unknown",
    providerPriority: ref?.key ?? ref?.id ?? raw,
  };
}

/**
 * Prefer raw provider status. Normalized group only when type/key mapping is reliable.
 */
export function mapTrackerStatus(ref?: TrackerRef | null): {
  status: TaskStatus;
  providerStatus: { id?: string; key?: string; displayLabel?: string } | null;
} {
  if (!ref) return { status: "unknown", providerStatus: null };
  const providerStatus = {
    ...(ref.id ? { id: ref.id } : {}),
    ...(ref.key ? { key: ref.key } : {}),
    ...(ref.display ? { displayLabel: ref.display } : {}),
  };
  const candidate = (ref.key ?? ref.id ?? "").toLowerCase().replace(/[\s-]/g, "");
  const status = STATUS_TYPE_MAP[candidate] ?? "unknown";
  return { status, providerStatus };
}

export function toTrackerPriorityKey(priority: TaskPriority): string | undefined {
  switch (priority) {
    case "low": return "low";
    case "normal": return "normal";
    case "high": return "high";
    case "critical": return "critical";
    default: return undefined;
  }
}

export function deadlineToUnix(deadline?: string | null): number | null {
  if (!deadline) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(deadline);
  const ms = Date.parse(dateOnly ? `${deadline}T00:00:00.000Z` : deadline);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

export function unixToDeadline(dueAt?: number | null): string | undefined {
  if (dueAt == null) return undefined;
  return new Date(dueAt * 1000).toISOString().slice(0, 10);
}

export function parseTrackerTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}
