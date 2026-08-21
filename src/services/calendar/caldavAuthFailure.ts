import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

class CalDavAuthenticationError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`CalDAV authentication failed (${status})`);
    this.name = "CalDavAuthenticationError";
    this.status = status;
  }
}

const AUTH_FAILURE_MARKERS =
  /invalid[- ]?token|token (?:is )?(?:expired|invalid)|expired (?:access )?token|invalid credentials|authentication (?:failed|required)|not authenticated|unauthorized|oauth.*(?:expired|invalid)/i;

/**
 * Preserve DAV responses except for explicit authentication failures.
 * In particular, discovery 404 and permission-only 403 responses pass through.
 */
export const calDavSessionFetch: typeof tauriFetch = async (input, init) => {
  const response = await tauriFetch(input, init);
  if (response.status === 401) throw new CalDavAuthenticationError(401);

  if (response.status === 403) {
    const authenticateHeader = response.headers.get("www-authenticate") ?? "";
    let body = "";
    try {
      body = await response.clone().text();
    } catch {
      // A body is optional; the auth header is sufficient when present.
    }
    if (authenticateHeader || AUTH_FAILURE_MARKERS.test(body)) {
      throw new CalDavAuthenticationError(403);
    }
  }

  return response;
};

export function isCalDavAuthFailure(error: unknown): boolean {
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  } | null;
  const status = [candidate?.status, candidate?.statusCode, candidate?.response?.status]
    .find((value): value is number => typeof value === "number");
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (status === 401 || /\b401\b/.test(message)) return true;
  if (/invalid credentials|authentication (?:failed|required)|not authenticated|unauthorized/i.test(message)) {
    return true;
  }

  const isForbidden = status === 403 || /\b403\b/.test(message);
  return isForbidden && AUTH_FAILURE_MARKERS.test(message);
}
