import { yandex360Request } from "./client";
import type { JsonValue } from "./types";

export interface AuditLogQuery {
  [key: string]: string | number | boolean | null | undefined;
  started_at?: string;
  ended_at?: string;
  types?: string;
  include_uids?: string;
  exclude_uids?: string;
  ip?: string;
  service?: string;
  count?: number;
  page_token?: string;
}

export function getOrganizationAuditLogs(
  orgId: string,
  query: AuditLogQuery = {},
  accountId?: string,
): Promise<JsonValue> {
  return yandex360Request({
    accountId,
    method: "GET",
    path: "/v1/auditlog/organizations/{orgId}/events",
    pathParams: { orgId },
    query,
  });
}
