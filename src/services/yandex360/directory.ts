import { yandex360Request } from "./client";
import type { JsonObject, JsonValue } from "./types";

export function listOrganizations(accountId?: string): Promise<JsonValue> {
  return yandex360Request({ accountId, method: "GET", path: "/v1/orgs" });
}

export function listUsers(orgId: string, accountId?: string): Promise<JsonValue> {
  return yandex360Request({
    accountId,
    method: "GET",
    path: "/v1/orgs/{orgId}/users",
    pathParams: { orgId },
  });
}

export function getUser(orgId: string, userId: string, accountId?: string): Promise<JsonValue> {
  return yandex360Request({
    accountId,
    method: "GET",
    path: "/v1/orgs/{orgId}/users/{userId}",
    pathParams: { orgId, userId },
  });
}

export function createUser(orgId: string, body: JsonObject, accountId?: string): Promise<JsonValue> {
  return yandex360Request({
    accountId,
    method: "POST",
    path: "/v1/orgs/{orgId}/users",
    pathParams: { orgId },
    body,
  });
}

export function updateUser(
  orgId: string,
  userId: string,
  body: JsonObject,
  accountId?: string,
): Promise<JsonValue> {
  return yandex360Request({
    accountId,
    method: "PATCH",
    path: "/v1/orgs/{orgId}/users/{userId}",
    pathParams: { orgId, userId },
    body,
  });
}

export function deleteUser(orgId: string, userId: string, accountId?: string): Promise<JsonValue> {
  return yandex360Request({
    accountId,
    method: "DELETE",
    path: "/v1/orgs/{orgId}/users/{userId}",
    pathParams: { orgId, userId },
  });
}
