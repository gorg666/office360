import { normalizeEmail } from "@/utils/emailUtils";
import type { TaskPrincipalRef } from "../domain";
import type { TrackerUser } from "@/services/yandex/trackerClient";

export function principalFromTrackerUser(
  user: TrackerUser | null | undefined,
  organizationId: string,
): TaskPrincipalRef | null {
  if (!user) return null;
  const email = user.email?.trim();
  if (!email) {
    // Tracker may omit email; keep a synthetic local address only for cache identity.
    const login = user.login?.trim();
    if (!login) return null;
    return {
      email: `${login}@tracker.local`,
      displayName: user.display ?? login,
      providerUid: String(user.uid ?? user.trackerUid ?? ""),
      organizationId,
    };
  }
  return {
    email,
    displayName: user.display ?? email,
    providerUid: String(user.uid ?? user.trackerUid ?? ""),
    organizationId,
    ...(user.passportUid != null
      ? {
          person: {
            id: `yandex-dir:${user.passportUid}`,
            email,
            normalizedEmail: normalizeEmail(email),
            providerId: String(user.passportUid),
            displayName: user.display,
            source: "organization-directory" as const,
            sources: ["organization-directory" as const],
          },
        }
      : {}),
  };
}

export function trackerUidOf(user: TrackerUser): string | null {
  const uid = user.uid ?? user.trackerUid;
  if (uid == null || String(uid).trim() === "") return null;
  return String(uid);
}
