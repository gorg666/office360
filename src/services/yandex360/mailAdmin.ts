import { yandex360Request } from "./client";
import type { JsonObject, JsonValue } from "./types";

export function getOrganizationMailSettings(orgId: string, accountId?: string): Promise<JsonValue> {
  return yandex360Request({
    accountId,
    method: "GET",
    path: "/v1/orgs/{orgId}/mail/settings",
    pathParams: { orgId },
  });
}

export function updateOrganizationMailSettings(
  orgId: string,
  body: JsonObject,
  accountId?: string,
): Promise<JsonValue> {
  return yandex360Request({
    accountId,
    method: "PATCH",
    path: "/v1/orgs/{orgId}/mail/settings",
    pathParams: { orgId },
    body,
  });
}

export function listSharedMailboxes(orgId: string, accountId?: string): Promise<JsonValue> {
  return yandex360Request({
    accountId,
    method: "GET",
    path: "/v1/orgs/{orgId}/mailboxes/shared",
    pathParams: { orgId },
  });
}

export function createSharedMailbox(
  orgId: string,
  body: JsonObject,
  accountId?: string,
): Promise<JsonValue> {
  return yandex360Request({
    accountId,
    method: "POST",
    path: "/v1/orgs/{orgId}/mailboxes/shared",
    pathParams: { orgId },
    body,
  });
}
