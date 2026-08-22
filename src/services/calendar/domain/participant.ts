export interface ParticipantRef {
  kind: "email" | "account" | "provider";
  value: string;
  normalizedEmail: string | null;
  accountId?: string;
  providerId?: string;
  displayName?: string;
}

/** Office360 currently compares email identities case-insensitively; presentation casing is preserved in value. */
export function normalizeParticipantEmail(value: string): string {
  return value.trim().replace(/^mailto:/i, "").toLowerCase();
}

export function participantRefFromEmail(email: string, displayName?: string): ParticipantRef {
  const value = email.trim().replace(/^mailto:/i, "");
  return {
    kind: "email",
    value,
    normalizedEmail: normalizeParticipantEmail(value),
    ...(displayName ? { displayName } : {}),
  };
}
