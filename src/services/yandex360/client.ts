import { YANDEX360_API_BASE_URL, getYandex360Endpoint } from "./catalog";
import { Yandex360ApiError } from "./errors";
import { getYandex360AccessToken } from "./auth";
import type {
  JsonValue,
  Yandex360OperationInput,
  Yandex360RequestOptions,
} from "./types";

export async function yandex360Request<T = JsonValue>(
  options: Yandex360RequestOptions,
): Promise<T> {
  const token = options.token ?? (await getYandex360AccessToken(options.accountId));
  const path = interpolatePath(options.path, options.pathParams ?? {});
  const url = new URL(path, YANDEX360_API_BASE_URL);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    method: options.method,
    headers: {
      Authorization: `OAuth ${token}`,
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Yandex360ApiError({
      status: response.status,
      statusText: response.statusText,
      body: text,
    });
  }

  if (!text) {
    return null as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export async function executeYandex360Operation<T = JsonValue>(
  input: Yandex360OperationInput,
): Promise<T> {
  const endpoint = getYandex360Endpoint(input.endpointId);
  if (!endpoint) {
    throw new Error(`Unknown Yandex 360 endpoint: ${input.endpointId}`);
  }

  return yandex360Request<T>({
    token: input.token,
    accountId: input.accountId,
    method: endpoint.method,
    path: endpoint.path,
    pathParams: input.pathParams,
    query: input.query,
    body: input.body,
  });
}

export function interpolatePath(
  path: string,
  params: Record<string, string | number>,
): string {
  return path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing path parameter: ${key}`);
    }
    return encodeURIComponent(String(value));
  });
}
