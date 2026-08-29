import type { OrganizationTaskSettings } from "../domain";
import { TaskError } from "./errors";
import {
  getTrackerMyself,
  type TrackerRequestContext,
  type TrackerUser,
} from "@/services/yandex/trackerClient";

export interface ResolvedTrackerOrganization {
  organizationId: string;
  providerOrganizationId: string;
  defaultQueue: string | null;
  ctx: TrackerRequestContext;
  myself: TrackerUser;
}

export async function resolveTrackerOrganizationContext(input: {
  settings: OrganizationTaskSettings | null;
  accountId: string | null;
  requireEnabled?: boolean;
  fetchMyself?: (ctx: TrackerRequestContext) => Promise<TrackerUser>;
}): Promise<ResolvedTrackerOrganization> {
  const settings = input.settings;
  if (!settings || !settings.enabled) {
    throw new TaskError("configuration-required", "Yandex Tracker tasks are not enabled for this organization");
  }
  if (settings.provider !== "yandex-tracker") {
    throw new TaskError("configuration-required", "Organization is not bound to Yandex Tracker");
  }
  const providerOrganizationId = settings.providerOrganizationId?.trim();
  if (!providerOrganizationId) {
    throw new TaskError("configuration-required", "providerOrganizationId / X-Org-ID is not configured");
  }

  const ctx: TrackerRequestContext = {
    accountId: input.accountId,
    orgId: providerOrganizationId,
  };

  const fetchMyself = input.fetchMyself ?? getTrackerMyself;
  let myself: TrackerUser;
  try {
    myself = await fetchMyself(ctx);
  } catch (error) {
    throw mapOrgProbeError(error);
  }

  return {
    organizationId: settings.organizationId,
    providerOrganizationId,
    defaultQueue: settings.defaultQueue,
    ctx,
    myself,
  };
}

function mapOrgProbeError(error: unknown): TaskError {
  const status = (error as { status?: number })?.status;
  if (status === 401) return new TaskError("unauthorized", "Tracker authorization failed", { cause: error });
  if (status === 403) return new TaskError("permission-denied", "Tracker organization access denied", { cause: error });
  if (status === 404) return new TaskError("organization-mismatch", "Tracker organization was not found", { cause: error });
  return new TaskError("unavailable", "Tracker organization context is unavailable", {
    retryable: true,
    cause: error,
  });
}
