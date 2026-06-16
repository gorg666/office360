import type {
  ConnectionDiagnostic,
  DiagnosticContext,
  DiagnosticProvider,
  DiagnosticReason,
  DiagnosticUserAction,
} from "./types";
import { redactDiagnosticText } from "./redaction";

function normalizeProvider(provider: DiagnosticContext["provider"]): DiagnosticProvider {
  if (provider === "gmail_api" || provider === "imap" || provider === "caldav" || provider === "exchange") {
    return provider;
  }
  return "unknown";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function reasonFromMessage(raw: string, context: DiagnosticContext): DiagnosticReason {
  if (/sqlite_busy|database is locked|database busy|local db|sql error|sqlite|database/i.test(raw)) {
    return "local_database_error";
  }
  if (/missing.*scope|invalid_scope|scope.*missing|permission.*denied|insufficient.*scope/i.test(raw)) {
    return "missing_scope";
  }
  if (/expired|invalid_grant|refresh token|token.*revoked|token.*invalid|no refresh token|no access token/i.test(raw)) {
    return "expired_token";
  }
  if (/tls|ssl|certificate|cert verify|cert.*invalid|handshake/i.test(raw)) {
    return "tls_failed";
  }
  if (/dns|enotfound|server not found|getaddrinfo|name or service not known/i.test(raw)) {
    return "dns_failed";
  }
  if (/timed out|timeout|deadline|elapsed/i.test(raw)) {
    return "timeout";
  }
  if (/failed to fetch|network error|econnrefused|connection refused|server unreachable|tcp connect failed|could not connect|network unreachable/i.test(raw)) {
    return "server_unreachable";
  }
  if (/\b429\b|rate limit|rate_limited|too many requests/i.test(raw)) {
    return "rate_limited";
  }
  if (/\b403\b|forbidden|недостаточно прав|tariff|тариф/i.test(raw)) {
    return "unsupported_capability";
  }
  if (/quota|storage full|over quota/i.test(raw)) {
    return "quota";
  }
  if (/unsupported|not supported|capability/i.test(raw)) {
    return "unsupported_capability";
  }
  if (/\b401\b|\b403\b|authentication failed|login failed|invalid credentials|invalid password|bad password|535|5\.7\.8|xoauth2/i.test(raw)) {
    return context.authMethod === "oauth2" ? "expired_token" : "invalid_credentials";
  }
  if (/provider|api error|http \d{3}|status \d{3}/i.test(raw)) {
    return "provider_error";
  }
  return "provider_error";
}

function userActionFor(reason: DiagnosticReason, context: DiagnosticContext): DiagnosticUserAction {
  switch (reason) {
    case "expired_token":
    case "missing_scope":
      return "reauth";
    case "invalid_credentials":
      return context.authMethod === "oauth2" ? "reauth" : "check_password";
    case "tls_failed":
      return "check_tls";
    case "server_unreachable":
    case "dns_failed":
      return "edit_settings";
    case "timeout":
    case "rate_limited":
    case "provider_error":
    case "local_database_error":
      return "retry";
    case "quota":
      return "wait";
    case "unsupported_capability":
      return "contact_admin";
    default:
      return "export_debug";
  }
}

function isRetryable(reason: DiagnosticReason): boolean {
  return reason === "server_unreachable" ||
    reason === "dns_failed" ||
    reason === "timeout" ||
    reason === "rate_limited" ||
    reason === "provider_error" ||
    reason === "local_database_error";
}

function userMessageFor(reason: DiagnosticReason, context: DiagnosticContext): string {
  const layerName = context.layer.toUpperCase();
  switch (reason) {
    case "expired_token":
      return "Сессия аккаунта истекла. Войдите в аккаунт заново.";
    case "missing_scope":
      return "Аккаунту не хватает разрешений. Повторите вход с нужными правами.";
    case "invalid_credentials":
      return context.authMethod === "oauth2"
        ? "OAuth-авторизация не прошла. Войдите в аккаунт заново."
        : `${layerName}: не удалось войти. Проверьте пароль или пароль приложения.`;
    case "tls_failed":
      return `${layerName}: не удалось установить защищённое соединение. Проверьте SSL/TLS и сертификат.`;
    case "dns_failed":
      return `${layerName}: сервер не найден. Проверьте имя хоста.`;
    case "server_unreachable":
      return `${layerName}: сервер недоступен. Проверьте адрес, порт, VPN или firewall.`;
    case "timeout":
      return `${layerName}: сервер не ответил вовремя. Можно повторить попытку.`;
    case "quota":
      return "Провайдер сообщил о quota/storage limit. Освободите место или повторите позже.";
    case "rate_limited":
      return "Провайдер временно ограничил запросы. Повторите позже.";
    case "unsupported_capability":
      return "Это действие не поддерживается текущим провайдером.";
    case "local_database_error":
      return "Локальная база временно недоступна. Повторите операцию.";
    case "provider_error":
      return `${layerName}: провайдер вернул ошибку. Повторите попытку.`;
    default:
      return `${layerName}: не удалось определить причину. Экспортируйте debug bundle для анализа.`;
  }
}

function debugCodeFor(reason: DiagnosticReason, context: DiagnosticContext): string {
  return `${context.layer}.${context.operation}.${reason}`.replace(/[^a-z0-9_.-]+/gi, "_").toUpperCase();
}

export function createConnectionDiagnostic(
  error: unknown,
  context: DiagnosticContext,
): ConnectionDiagnostic {
  const raw = messageOf(error);
  const reason = reasonFromMessage(raw, context);
  const retryable = isRetryable(reason);
  const now = Math.floor(Date.now() / 1000);
  const severity = reason === "expired_token" ||
    reason === "invalid_credentials" ||
    reason === "tls_failed" ||
    reason === "missing_scope"
    ? "blocked"
    : "error";

  return {
    accountId: context.accountId,
    provider: normalizeProvider(context.provider),
    layer: context.layer,
    operation: context.operation,
    reason,
    severity,
    retryable,
    retryState: context.retryState ?? (retryable ? "scheduled" : "blocked"),
    retryCount: context.retryCount ?? 0,
    userMessage: userMessageFor(reason, context),
    userAction: userActionFor(reason, context),
    debugCode: debugCodeFor(reason, context),
    rawCause: redactDiagnosticText(raw),
    occurredAt: now,
    updatedAt: now,
  };
}

export function createSuccessDiagnostic(context: DiagnosticContext): ConnectionDiagnostic {
  const now = Math.floor(Date.now() / 1000);
  return {
    accountId: context.accountId,
    provider: normalizeProvider(context.provider),
    layer: context.layer,
    operation: context.operation,
    reason: "unknown",
    severity: "info",
    retryable: false,
    retryState: "idle",
    retryCount: 0,
    userMessage: `${context.layer.toUpperCase()}: подключение работает.`,
    userAction: "retry",
    debugCode: debugCodeFor("unknown", context),
    occurredAt: now,
    updatedAt: now,
  };
}

export function diagnosticSummary(diagnostic: ConnectionDiagnostic): string {
  return diagnostic.userMessage;
}
