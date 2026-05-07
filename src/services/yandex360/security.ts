import { yandex360Request } from "./client";
import type { JsonObject, JsonValue } from "./types";

export function getSecuritySettings(orgId: string, accountId?: string): Promise<JsonValue> {
  return yandex360Request({
    accountId,
    method: "GET",
    path: "/v1/orgs/{orgId}/security/settings",
    pathParams: { orgId },
  });
}

export function updateSecuritySettings(
  orgId: string,
  body: JsonObject,
  accountId?: string,
): Promise<JsonValue> {
  return yandex360Request({
    accountId,
    method: "PATCH",
    path: "/v1/orgs/{orgId}/security/settings",
    pathParams: { orgId },
    body,
  });
}

export function listServiceApplications(orgId: string, accountId?: string): Promise<JsonValue> {
  return yandex360Request({
    accountId,
    method: "GET",
    path: "/v1/orgs/{orgId}/security/service-applications",
    pathParams: { orgId },
  });
}
