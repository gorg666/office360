export type ErrorType = "network" | "auth" | "quota" | "server" | "permanent";

export interface ClassifiedError {
  type: ErrorType;
  isRetryable: boolean;
  message: string;
}

const NETWORK_PATTERNS = [
  "failed to fetch",
  "network",
  "timeout",
  "timed out",
  "econnrefused",
  "connection refused",
  "econnreset",
  "enotfound",
  "dns",
  "socket hang up",
  "socket",
  "aborted",
  "network error",
  "net::err",
  "tcp connect",
  "tls handshake",
];

const AUTH_PATTERNS = [
  "authentication failed",
  "login failed",
  "invalid credentials",
  "login denied",
  "authenticate failed",
];

export function classifyError(error: unknown): ClassifiedError {
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  const lower = message.toLowerCase();

  // Check for HTTP status codes in the message
  const statusMatch = lower.match(/\b(4\d{2}|5\d{2})\b/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]!, 10) : null;

  if (statusCode === 401 || statusCode === 403) {
    return { type: "auth", isRetryable: false, message };
  }

  if (statusCode === 429) {
    return { type: "quota", isRetryable: true, message };
  }

  if (statusCode !== null && statusCode >= 500) {
    return { type: "server", isRetryable: true, message };
  }

  // Check IMAP auth error patterns
  if (AUTH_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return { type: "auth", isRetryable: false, message };
  }

  // Check network error patterns
  if (NETWORK_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return { type: "network", isRetryable: true, message };
  }

  // Check if the error object has a status property (e.g., fetch Response errors)
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: number }).status;
    if (status === 401 || status === 403) {
      return { type: "auth", isRetryable: false, message };
    }
    if (status === 429) {
      return { type: "quota", isRetryable: true, message };
    }
    if (status >= 500) {
      return { type: "server", isRetryable: true, message };
    }
  }

  return { type: "permanent", isRetryable: false, message };
}

/**
 * Translate a raw sync error string into a user-friendly message.
 */
export function formatSyncError(rawError: string): string {
  const lower = rawError.toLowerCase();

  if (AUTH_PATTERNS.some((p) => lower.includes(p))) {
    return lower.includes("oauth") || lower.includes("token")
      ? "Ошибка авторизации OAuth — войдите в аккаунт заново"
      : "Ошибка авторизации — проверьте пароль или пароль приложения";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "Сервер не ответил вовремя — проверьте интернет и настройки почты";
  }
  if (lower.includes("tls") || lower.includes("ssl") || lower.includes("certificate")) {
    return "Не удалось установить защищённое соединение — проверьте тип защиты";
  }
  if (lower.includes("econnrefused") || lower.includes("connection refused")) {
    return "Почтовый сервер недоступен — проверьте адрес и порт";
  }
  if (lower.includes("dns") || lower.includes("enotfound") || lower.includes("server not found")) {
    return "Сервер не найден — проверьте имя хоста";
  }

  // Fallback: truncate long technical errors
  if (rawError.length > 100) {
    return rawError.slice(0, 100) + "\u2026";
  }
  return rawError;
}

/**
 * User-facing Russian text for compose send / draft save failures (SMTP, IMAP, Gmail).
 */
export function formatEmailSendOrDraftError(rawError: string): string {
  const trimmed = rawError.trim();
  const lower = trimmed.toLowerCase();

  if (lower.includes("no recipients found in email")) {
    return "Укажите получателя";
  }
  if (lower.includes("no from address found in email")) {
    return "Не указан адрес отправителя в письме";
  }
  if (lower.includes("failed to parse email for envelope")) {
    return "Не удалось разобрать письмо для отправки";
  }
  if (lower.includes("invalid from address")) {
    return "Некорректный адрес отправителя";
  }
  if (lower.includes("envelope error")) {
    return "Ошибка формирования конверта письма";
  }
  if (lower.includes("base64 decode error")) {
    return "Ошибка кодирования письма";
  }

  const smtpSendFailed = /^smtp\s+send\s+failed:\s*(.+)$/i.exec(trimmed);
  if (smtpSendFailed?.[1]) {
    return `Ошибка отправки. ${formatSyncError(smtpSendFailed[1].trim())}`;
  }

  if (lower.includes("imap ok, but smtp failed")) {
    const inner = trimmed.replace(/^imap ok, but smtp failed:\s*/i, "").trim();
    return `Ошибка SMTP при сохранении на сервере. ${formatSyncError(inner)}`;
  }

  const smtpSendErrIdx = lower.indexOf("smtp send error:");
  if (smtpSendErrIdx !== -1) {
    const inner = trimmed.slice(smtpSendErrIdx + "smtp send error:".length).trim();
    return `Ошибка отправки SMTP. ${formatSyncError(inner)}`;
  }

  if (lower.includes("subject required") || lower.includes("missing subject")) {
    return "Укажите тему";
  }
  if (lower.includes("recipient required") || lower.includes("missing recipient")) {
    return "Укажите получателя";
  }

  return formatSyncError(trimmed);
}
