import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { DAVClient } from "tsdav";

function isCalDavUnauthorizedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message;
  return m === "Invalid credentials" || /\b401\b/i.test(m);
}

/**
 * Yandex CalDAV accepts the mail OAuth token; the HTTP Authorization scheme is not documented
 * uniformly — try `OAuth` (same as cloud-api / login.yandex.ru) then `Bearer` (common for XOAUTH2).
 */
export async function loginYandexCalDavClient(
  serverUrl: string,
  accessToken: string,
): Promise<DAVClient> {
  const { DAVClient } = await import("tsdav");
  const common = {
    serverUrl,
    credentials: { accessToken },
    defaultAccountType: "caldav" as const,
    fetch: tauriFetch,
  };

  const oauthClient = new DAVClient({
    ...common,
    authMethod: "Custom",
    authFunction: async () => ({ authorization: `OAuth ${accessToken}` }),
  });
  try {
    await oauthClient.login();
    return oauthClient;
  } catch (err) {
    if (!isCalDavUnauthorizedError(err)) throw err;
  }

  const bearerClient = new DAVClient({
    ...common,
    authMethod: "Bearer",
  });
  await bearerClient.login();
  return bearerClient;
}
