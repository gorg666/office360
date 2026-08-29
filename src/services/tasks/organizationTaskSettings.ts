import {
  getOrganizationTaskSettings as getDbSettings,
  upsertOrganizationTaskSettings as upsertDbSettings,
} from "@/services/db/taskProjection";
import type { OrganizationTaskSettings, TaskProviderId } from "./domain";

export async function getOrganizationTaskSettings(
  organizationId: string,
  provider: TaskProviderId,
): Promise<OrganizationTaskSettings | null> {
  const row = await getDbSettings(organizationId, provider);
  return row ? {
    organizationId: row.organization_id,
    provider: row.provider,
    enabled: row.enabled === 1,
    providerOrganizationId: row.provider_organization_id,
    defaultQueue: row.default_queue,
    updatedAt: row.updated_at,
  } : null;
}

export async function upsertOrganizationTaskSettings(
  settings: OrganizationTaskSettings,
): Promise<void> {
  await upsertDbSettings({
    organization_id: settings.organizationId,
    provider: settings.provider,
    enabled: settings.enabled ? 1 : 0,
    provider_organization_id: settings.providerOrganizationId,
    default_queue: settings.defaultQueue,
    updated_at: settings.updatedAt,
  });
}
