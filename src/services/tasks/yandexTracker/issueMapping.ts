import type { Task } from "../domain";
import { mapTrackerPriority, mapTrackerStatus, parseTrackerTimestamp, deadlineToUnix } from "./mapping";
import { principalFromTrackerUser } from "./principal";
import type { TrackerIssue, TrackerUser } from "@/services/yandex/trackerClient";

function asUser(value: unknown): TrackerUser | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as TrackerUser;
}

export function mapTrackerIssueToTask(input: {
  issue: TrackerIssue;
  organizationId: string;
  localId?: string;
  now?: number;
}): Task {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const { status, providerStatus } = mapTrackerStatus(input.issue.status);
  const { priority, providerPriority } = mapTrackerPriority(input.issue.priority);
  const createdAt = parseTrackerTimestamp(input.issue.createdAt) ?? now;
  const updatedAt = parseTrackerTimestamp(input.issue.updatedAt) ?? createdAt;

  return {
    id: input.localId ?? `yandex-tracker:${input.organizationId}:${input.issue.id}`,
    provider: "yandex-tracker",
    providerTaskId: input.issue.id,
    externalKey: input.issue.key,
    organizationId: input.organizationId,
    title: input.issue.summary,
    description: input.issue.description ?? null,
    status,
    providerStatus,
    priority,
    providerPriority,
    assignee: principalFromTrackerUser(asUser(input.issue.assignee), input.organizationId),
    createdBy: principalFromTrackerUser(asUser(input.issue.createdBy), input.organizationId),
    followers: (input.issue.followers ?? [])
      .map((follower) => principalFromTrackerUser(asUser(follower), input.organizationId))
      .filter((value): value is NonNullable<typeof value> => Boolean(value)),
    dueAt: deadlineToUnix(input.issue.deadline),
    createdAt,
    updatedAt,
    providerUpdatedAt: updatedAt,
    syncState: "fresh",
    source: [],
  };
}
