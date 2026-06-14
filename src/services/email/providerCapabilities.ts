import type { CapabilitySupport, ProviderCapabilities } from "./types";

const IMAP_LABEL_UNSUPPORTED =
  "This provider does not support native labels.";
const RETENTION_UNSUPPORTED =
  "Retention policy visibility is not exposed through the current mail provider.";
const CALDAV_MAIL_UNSUPPORTED =
  "CalDAV accounts are calendar-only and do not support mail actions.";
export const EXCHANGE_UNSUPPORTED_REASON =
  "Native Exchange/Graph support is planned but unavailable in this build. Use Microsoft OAuth over IMAP/SMTP for compatible Outlook mail accounts.";

function yes(): CapabilitySupport {
  return { supported: true };
}

function no(reason: string): CapabilitySupport {
  return { supported: false, reason };
}

export const GMAIL_CAPABILITIES: ProviderCapabilities = {
  provider: "gmail_api",
  folders: {
    list: yes(),
    create: yes(),
    rename: yes(),
    delete: yes(),
    subscribe: no("Gmail labels do not expose IMAP folder subscriptions."),
    quota: no("Gmail quota is not exposed through the current mail provider."),
    retention: no(RETENTION_UNSUPPORTED),
  },
  labels: {
    native: yes(),
    create: yes(),
    rename: yes(),
    delete: yes(),
    add: yes(),
    remove: yes(),
    color: yes(),
  },
  messages: {
    archive: yes(),
    trash: yes(),
    permanentDelete: yes(),
    move: yes(),
    markRead: yes(),
    star: yes(),
    spam: yes(),
    rawFetch: yes(),
  },
  compose: {
    send: yes(),
    remoteDrafts: yes(),
    appendSent: yes(),
    aliases: yes(),
  },
  diagnostics: {
    testIncoming: yes(),
    testOutgoing: yes(),
    testOAuth: yes(),
    exportDebug: yes(),
  },
};

export const IMAP_CAPABILITIES: ProviderCapabilities = {
  provider: "imap",
  folders: {
    list: yes(),
    create: yes(),
    rename: yes(),
    delete: yes(),
    subscribe: yes(),
    quota: yes(),
    retention: no(RETENTION_UNSUPPORTED),
  },
  labels: {
    native: no(IMAP_LABEL_UNSUPPORTED),
    create: no(IMAP_LABEL_UNSUPPORTED),
    rename: no(IMAP_LABEL_UNSUPPORTED),
    delete: no(IMAP_LABEL_UNSUPPORTED),
    add: no(IMAP_LABEL_UNSUPPORTED),
    remove: no(IMAP_LABEL_UNSUPPORTED),
    color: no(IMAP_LABEL_UNSUPPORTED),
  },
  messages: {
    archive: yes(),
    trash: yes(),
    permanentDelete: yes(),
    move: yes(),
    markRead: yes(),
    star: yes(),
    spam: yes(),
    rawFetch: yes(),
  },
  compose: {
    send: yes(),
    remoteDrafts: yes(),
    appendSent: yes(),
    aliases: no("SMTP aliases are not exposed through the current mail provider."),
  },
  diagnostics: {
    testIncoming: yes(),
    testOutgoing: yes(),
    testOAuth: yes(),
    exportDebug: yes(),
  },
};

export const CALDAV_CAPABILITIES: ProviderCapabilities = {
  provider: "caldav",
  folders: {
    list: no(CALDAV_MAIL_UNSUPPORTED),
    create: no(CALDAV_MAIL_UNSUPPORTED),
    rename: no(CALDAV_MAIL_UNSUPPORTED),
    delete: no(CALDAV_MAIL_UNSUPPORTED),
    subscribe: no(CALDAV_MAIL_UNSUPPORTED),
    quota: no(CALDAV_MAIL_UNSUPPORTED),
    retention: no(CALDAV_MAIL_UNSUPPORTED),
  },
  labels: {
    native: no(CALDAV_MAIL_UNSUPPORTED),
    create: no(CALDAV_MAIL_UNSUPPORTED),
    rename: no(CALDAV_MAIL_UNSUPPORTED),
    delete: no(CALDAV_MAIL_UNSUPPORTED),
    add: no(CALDAV_MAIL_UNSUPPORTED),
    remove: no(CALDAV_MAIL_UNSUPPORTED),
    color: no(CALDAV_MAIL_UNSUPPORTED),
  },
  messages: {
    archive: no(CALDAV_MAIL_UNSUPPORTED),
    trash: no(CALDAV_MAIL_UNSUPPORTED),
    permanentDelete: no(CALDAV_MAIL_UNSUPPORTED),
    move: no(CALDAV_MAIL_UNSUPPORTED),
    markRead: no(CALDAV_MAIL_UNSUPPORTED),
    star: no(CALDAV_MAIL_UNSUPPORTED),
    spam: no(CALDAV_MAIL_UNSUPPORTED),
    rawFetch: no(CALDAV_MAIL_UNSUPPORTED),
  },
  compose: {
    send: no(CALDAV_MAIL_UNSUPPORTED),
    remoteDrafts: no(CALDAV_MAIL_UNSUPPORTED),
    appendSent: no(CALDAV_MAIL_UNSUPPORTED),
    aliases: no(CALDAV_MAIL_UNSUPPORTED),
  },
  diagnostics: {
    testIncoming: yes(),
    testOutgoing: no(CALDAV_MAIL_UNSUPPORTED),
    testOAuth: yes(),
    exportDebug: yes(),
  },
};

export const EXCHANGE_CAPABILITIES: ProviderCapabilities = {
  provider: "exchange",
  folders: {
    list: no(EXCHANGE_UNSUPPORTED_REASON),
    create: no(EXCHANGE_UNSUPPORTED_REASON),
    rename: no(EXCHANGE_UNSUPPORTED_REASON),
    delete: no(EXCHANGE_UNSUPPORTED_REASON),
    subscribe: no(EXCHANGE_UNSUPPORTED_REASON),
    quota: no(EXCHANGE_UNSUPPORTED_REASON),
    retention: no(EXCHANGE_UNSUPPORTED_REASON),
  },
  labels: {
    native: no(EXCHANGE_UNSUPPORTED_REASON),
    create: no(EXCHANGE_UNSUPPORTED_REASON),
    rename: no(EXCHANGE_UNSUPPORTED_REASON),
    delete: no(EXCHANGE_UNSUPPORTED_REASON),
    add: no(EXCHANGE_UNSUPPORTED_REASON),
    remove: no(EXCHANGE_UNSUPPORTED_REASON),
    color: no(EXCHANGE_UNSUPPORTED_REASON),
  },
  messages: {
    archive: no(EXCHANGE_UNSUPPORTED_REASON),
    trash: no(EXCHANGE_UNSUPPORTED_REASON),
    permanentDelete: no(EXCHANGE_UNSUPPORTED_REASON),
    move: no(EXCHANGE_UNSUPPORTED_REASON),
    markRead: no(EXCHANGE_UNSUPPORTED_REASON),
    star: no(EXCHANGE_UNSUPPORTED_REASON),
    spam: no(EXCHANGE_UNSUPPORTED_REASON),
    rawFetch: no(EXCHANGE_UNSUPPORTED_REASON),
  },
  compose: {
    send: no(EXCHANGE_UNSUPPORTED_REASON),
    remoteDrafts: no(EXCHANGE_UNSUPPORTED_REASON),
    appendSent: no(EXCHANGE_UNSUPPORTED_REASON),
    aliases: no(EXCHANGE_UNSUPPORTED_REASON),
  },
  diagnostics: {
    testIncoming: no(EXCHANGE_UNSUPPORTED_REASON),
    testOutgoing: no(EXCHANGE_UNSUPPORTED_REASON),
    testOAuth: no(EXCHANGE_UNSUPPORTED_REASON),
    exportDebug: yes(),
  },
};

export function getCapabilitiesForAccountProvider(
  provider: string | null | undefined,
): ProviderCapabilities {
  if (provider === "gmail_api") return GMAIL_CAPABILITIES;
  if (provider === "caldav") return CALDAV_CAPABILITIES;
  if (provider === "exchange") return EXCHANGE_CAPABILITIES;
  return IMAP_CAPABILITIES;
}

export function isCapabilitySupported(capability: CapabilitySupport): boolean {
  return capability.supported;
}

export function getUnsupportedReason(
  capability: CapabilitySupport,
  fallback = "This action is not supported by the current provider.",
): string | null {
  return capability.supported ? null : (capability.reason ?? fallback);
}

export function assertCapabilitySupported(
  capability: CapabilitySupport,
  actionLabel: string,
): void {
  if (!capability.supported) {
    throw new Error(`${actionLabel} is not supported. ${capability.reason ?? ""}`.trim());
  }
}
