export type Yandex360HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type Yandex360EndpointGroup =
  | "organizations"
  | "users"
  | "groups"
  | "departments"
  | "externalContacts"
  | "domains"
  | "mailboxes"
  | "mailSettings"
  | "antispam"
  | "routing"
  | "security"
  | "serviceApplications"
  | "auditLogs";

export type Yandex360OperationRisk = "read" | "write" | "destructive";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface Yandex360Scope {
  id: string;
  label: string;
  group: Yandex360EndpointGroup;
  access: "read" | "write";
}

export interface Yandex360EndpointDefinition {
  id: string;
  group: Yandex360EndpointGroup;
  label: string;
  description: string;
  method: Yandex360HttpMethod;
  path: string;
  scopes: string[];
  risk: Yandex360OperationRisk;
  pathParams?: string[];
  queryParams?: string[];
  bodyExample?: JsonObject;
  documentationUrl: string;
}

export interface Yandex360RequestOptions {
  token?: string;
  accountId?: string;
  method: Yandex360HttpMethod;
  path: string;
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: JsonValue;
}

export interface Yandex360OperationInput {
  endpointId: string;
  token?: string;
  accountId?: string;
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: JsonValue;
}

export interface Yandex360ApiErrorDetails {
  status: number;
  statusText: string;
  body: string;
}
