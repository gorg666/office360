export type TelemostCapability = "UNKNOWN" | "API_AVAILABLE" | "WEB_ONLY";

const KEY_PREFIX = "office360_telemost_capability";

export function getTelemostCapability(accountId: string): TelemostCapability {
  const value = localStorage.getItem(`${KEY_PREFIX}:${accountId}`);
  return value === "API_AVAILABLE" || value === "WEB_ONLY" ? value : "UNKNOWN";
}

export function setTelemostCapability(accountId: string, capability: TelemostCapability): void {
  localStorage.setItem(`${KEY_PREFIX}:${accountId}`, capability);
}

export function clearTelemostCapability(accountId: string): void {
  localStorage.removeItem(`${KEY_PREFIX}:${accountId}`);
}

export interface LocalTelemostMeeting {
  id: string;
  joinUrl: string;
  title: string | null;
  lastOpenedAt: number | null;
  source: "API_CREATED" | "WEB_CREATED" | "JOINED_LINK" | "CALENDAR";
  remoteConferenceId: string | null;
  createdAt: number | null;
  scheduledAt: number | null;
}
