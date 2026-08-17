export type MailProtocolErrorClass =
  | "OAUTH_SCOPE_MISSING"
  | "MAIL_PROTOCOL_DISABLED"
  | "IMAP_NETWORK_TIMEOUT"
  | "SMTP_NETWORK_TIMEOUT"
  | "AUTH_REJECTED"
  | "TOKEN_EXPIRED"
  | "SERVER_UNREACHABLE";

export interface ClassifiedMailError {
  class: MailProtocolErrorClass;
  message: string;
  authReached: boolean;
}

const YANDEX_CONNECT_MESSAGE = "Could not connect to Yandex Mail server";
const GENERIC_CONNECT_MESSAGE = "Could not connect to the mail server";

export const MAIL_ERROR_MESSAGES: Record<MailProtocolErrorClass, string> = {
  OAUTH_SCOPE_MISSING: "OAuth token is missing the required mail permissions",
  MAIL_PROTOCOL_DISABLED: "Enable IMAP and OAuth tokens in Yandex Mail settings",
  IMAP_NETWORK_TIMEOUT: YANDEX_CONNECT_MESSAGE,
  SMTP_NETWORK_TIMEOUT: YANDEX_CONNECT_MESSAGE,
  AUTH_REJECTED: "Yandex rejected the mail client sign-in",
  TOKEN_EXPIRED: "OAuth token expired. Sign in again.",
  SERVER_UNREACHABLE: YANDEX_CONNECT_MESSAGE,
};

export function isYandexMailHost(host: string | null | undefined): boolean {
  const normalized = (host ?? "").trim().toLowerCase();
  return (
    normalized === "imap.yandex.ru" ||
    normalized === "imap.yandex.com" ||
    normalized === "smtp.yandex.ru" ||
    normalized === "smtp.yandex.com"
  );
}

export function resolveMailboxEmail(typedEmail: string, oauthEmail?: string | null): string {
  const oauth = oauthEmail?.trim() ?? "";
  const typed = typedEmail.trim();
  if (oauth.includes("@")) return oauth;
  if (typed.includes("@")) return typed;
  return oauth || typed;
}

export function resolveMailboxUsername(
  email: string,
  imapUsername?: string | null,
  options?: { preferFullEmail?: boolean },
): string {
  const mailbox = email.trim();
  const explicit = imapUsername?.trim() ?? "";
  if (!options?.preferFullEmail) {
    return explicit || mailbox;
  }
  if (explicit.includes("@")) return explicit;
  if (mailbox.includes("@")) return mailbox;
  return explicit || mailbox;
}

export function classifyMailProtocolError(
  raw: string,
  protocol: "imap" | "smtp",
  host?: string,
): ClassifiedMailError {
  const text = raw.trim();
  const yandex = isYandexMailHost(host) || /yandex/i.test(text);
  const connectMessage = yandex ? YANDEX_CONNECT_MESSAGE : GENERIC_CONNECT_MESSAGE;

  if (isTimeoutOrConnectFailure(text)) {
    const networkClass = protocol === "smtp" ? "SMTP_NETWORK_TIMEOUT" : "IMAP_NETWORK_TIMEOUT";
    if (/dns lookup/i.test(text) && !/timed out/i.test(text)) {
      return { class: "SERVER_UNREACHABLE", message: connectMessage, authReached: false };
    }
    return { class: networkClass, message: connectMessage, authReached: false };
  }

  if (isTlsFailure(text)) {
    return { class: "SERVER_UNREACHABLE", message: connectMessage, authReached: false };
  }

  if (isMailProtocolDisabled(text)) {
    return {
      class: "MAIL_PROTOCOL_DISABLED",
      message: MAIL_ERROR_MESSAGES.MAIL_PROTOCOL_DISABLED,
      authReached: true,
    };
  }

  if (isTokenExpired(text)) {
    return {
      class: "TOKEN_EXPIRED",
      message: MAIL_ERROR_MESSAGES.TOKEN_EXPIRED,
      authReached: true,
    };
  }

  if (isScopeMissing(text)) {
    return {
      class: "OAUTH_SCOPE_MISSING",
      message: MAIL_ERROR_MESSAGES.OAUTH_SCOPE_MISSING,
      authReached: true,
    };
  }

  if (isAuthRejected(text)) {
    return {
      class: "AUTH_REJECTED",
      message: yandex ? MAIL_ERROR_MESSAGES.AUTH_REJECTED : text,
      authReached: true,
    };
  }

  return {
    class: "SERVER_UNREACHABLE",
    message: text,
    authReached: !/tcp|tls|dns/i.test(text),
  };
}

function isTimeoutOrConnectFailure(text: string): boolean {
  return /timed out after|did not complete within|не ответила за|tcp connect|connection refused|os error 10061|network is unreachable/i.test(
    text,
  );
}

function isTlsFailure(text: string): boolean {
  return /tls handshake|tls upgrade|certificate/i.test(text);
}

function isMailProtocolDisabled(text: string): boolean {
  return /mail_protocol_disabled|imap is disabled|imap.*disabled|enable imap|app passwords and oauth tokens|клиентов?\s+этой почты/i.test(
    text,
  );
}

function isTokenExpired(text: string): boolean {
  return /token.?expired|invalid_token|expired_token|token has been revoked/i.test(text);
}

function isScopeMissing(text: string): boolean {
  return /oauth_scope_missing|does not include smtp access|missing the required mail permissions|invalid_scope|mail permissions are missing/i.test(
    text,
  );
}

function isAuthRejected(text: string): boolean {
  return /authenticationfailed|xoauth2 authentication failed|login failed|535|5\.7\.8|invalid credentials|auth.*fail/i.test(
    text,
  );
}
