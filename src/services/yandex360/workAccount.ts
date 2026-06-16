import type { DbAccount } from "@/services/db/accounts";
import type { ConnectionDiagnostic } from "@/services/diagnostics";

export const YANDEX_MAIL_SCOPES = ["mail:imap_full", "mail:smtp"] as const;
export const YANDEX_CALENDAR_SCOPES = ["calendar:all"] as const;

export type Yandex360ServiceId = "mail" | "calendar" | "messenger" | "tracker";
export type Yandex360ServiceStatus = "available" | "needs_scope" | "needs_reauth" | "limited";

export interface Yandex360ServiceReadiness {
  id: Yandex360ServiceId;
  label: string;
  status: Yandex360ServiceStatus;
  summary: string;
  detail: string;
  requiredScopes: string[];
  missingScopes: string[];
  action?: "reauth" | "open_repair" | "wait" | "none";
}

export interface Yandex360WorkAccountStatus {
  account: DbAccount;
  displayName: string;
  email: string;
  scopeGrantKnown: boolean;
  needsReauth: boolean;
  limitationMessage: string | null;
  services: Yandex360ServiceReadiness[];
}

export function parseYandexOAuthScopes(scopeValue: string | null | undefined): Set<string> {
  if (!scopeValue?.trim()) return new Set();
  return new Set(
    scopeValue
      .split(/[,\s]+/)
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}

export function missingYandexScopes(scopes: Set<string>, required: readonly string[]): string[] {
  return required.filter((scope) => !scopes.has(scope));
}

export function isYandexOAuthWorkAccount(account: DbAccount): boolean {
  return account.provider === "imap" &&
    account.auth_method === "oauth2" &&
    account.oauth_provider === "yandex";
}

export function buildYandex360WorkAccountStatuses(
  accounts: DbAccount[],
  diagnostics: ConnectionDiagnostic[] = [],
): Yandex360WorkAccountStatus[] {
  return accounts
    .filter(isYandexOAuthWorkAccount)
    .map((account) => buildYandex360WorkAccountStatus(account, diagnostics));
}

export function buildYandex360WorkAccountStatus(
  account: DbAccount,
  diagnostics: ConnectionDiagnostic[] = [],
): Yandex360WorkAccountStatus {
  const accountDiagnostics = diagnostics.filter((diagnostic) => diagnostic.accountId === account.id);
  const needsReauth = accountDiagnostics.some(
    (diagnostic) => diagnostic.userAction === "reauth" ||
      diagnostic.reason === "expired_token" ||
      diagnostic.reason === "missing_scope",
  );
  const limitationMessage = yandexLimitationMessage(accountDiagnostics);
  const scopes = parseYandexOAuthScopes(account.oauth_granted_scopes);
  const scopeGrantKnown = scopes.size > 0;

  return {
    account,
    displayName: account.display_name || account.email,
    email: account.email,
    scopeGrantKnown,
    needsReauth,
    limitationMessage,
    services: [
      mailReadiness(scopes, scopeGrantKnown, needsReauth, limitationMessage),
      calendarReadiness(account, scopes, scopeGrantKnown, needsReauth, limitationMessage),
      messengerReadiness(needsReauth, limitationMessage),
      trackerReadiness(),
    ],
  };
}

function yandexLimitationMessage(diagnostics: ConnectionDiagnostic[]): string | null {
  const limited = diagnostics.find((diagnostic) =>
    diagnostic.reason === "rate_limited" ||
    diagnostic.reason === "unsupported_capability" ||
    /\b403\b|forbidden|недостаточно прав|тариф|rate limit|429/i.test(diagnostic.rawCause ?? diagnostic.userMessage),
  );
  if (!limited) return null;
  if (limited.reason === "rate_limited" || /\b429\b|rate limit/i.test(limited.rawCause ?? limited.userMessage)) {
    return "Яндекс временно ограничил частоту запросов. Повторите позже.";
  }
  return "Яндекс ограничил доступ по правам, тарифу или политике организации.";
}

function mailReadiness(
  scopes: Set<string>,
  scopeGrantKnown: boolean,
  needsReauth: boolean,
  limitationMessage: string | null,
): Yandex360ServiceReadiness {
  const missingScopes = scopeGrantKnown ? missingYandexScopes(scopes, YANDEX_MAIL_SCOPES) : [];
  if (needsReauth) {
    return service("mail", "Почта", "needs_reauth", "Нужна повторная авторизация", "OAuth-сессия или разрешения требуют обновления.", YANDEX_MAIL_SCOPES, missingScopes, "reauth");
  }
  if (missingScopes.length > 0) {
    return service("mail", "Почта", "needs_scope", "Не хватает прав на почту", "Повторите вход с доступом к IMAP и SMTP.", YANDEX_MAIL_SCOPES, missingScopes, "reauth");
  }
  if (limitationMessage) {
    return service("mail", "Почта", "limited", "Ограничено провайдером", limitationMessage, YANDEX_MAIL_SCOPES, missingScopes, "open_repair");
  }
  const detail = scopeGrantKnown
    ? "Разрешения на получение и отправку почты сохранены. Аккаунт готов к работе."
    : "Аккаунт подключен через Яндекс ID. Для старого подключения список разрешений не сохранен, но почтовые настройки уже есть.";
  return service("mail", "Почта", "available", "Готово", detail, YANDEX_MAIL_SCOPES, missingScopes);
}

function calendarReadiness(
  account: DbAccount,
  scopes: Set<string>,
  scopeGrantKnown: boolean,
  needsReauth: boolean,
  limitationMessage: string | null,
): Yandex360ServiceReadiness {
  const missingScopes = scopeGrantKnown ? missingYandexScopes(scopes, YANDEX_CALENDAR_SCOPES) : [];
  if (needsReauth) {
    return service("calendar", "Календарь", "needs_reauth", "Нужна повторная авторизация", "CalDAV использует тот же Яндекс OAuth grant.", YANDEX_CALENDAR_SCOPES, missingScopes, "reauth");
  }
  if (missingScopes.length > 0) {
    return service("calendar", "Календарь", "needs_scope", "Не хватает calendar:all", "Повторите вход с разрешением calendar:all для CalDAV.", YANDEX_CALENDAR_SCOPES, missingScopes, "reauth");
  }
  if (limitationMessage) {
    return service("calendar", "Календарь", "limited", "Ограничено провайдером", limitationMessage, YANDEX_CALENDAR_SCOPES, missingScopes, "open_repair");
  }
  const configured = account.calendar_provider === "caldav" || Boolean(account.caldav_url);
  return service(
    "calendar",
    "Календарь",
    configured ? "available" : "needs_scope",
    configured ? "Готово" : "Нужно включить CalDAV",
    configured
      ? "Используется подключение календаря Яндекса через CalDAV."
      : "Подключите календарь через повторный вход с calendar:all.",
    YANDEX_CALENDAR_SCOPES,
    configured || !scopeGrantKnown ? [] : [...YANDEX_CALENDAR_SCOPES],
    configured ? "none" : "reauth",
  );
}

function messengerReadiness(
  needsReauth: boolean,
  limitationMessage: string | null,
): Yandex360ServiceReadiness {
  if (needsReauth) {
    return service("messenger", "Мессенджер", "needs_reauth", "Нужна повторная авторизация", "Обновите вход в Яндекс ID перед использованием Мессенджера.", [], [], "reauth");
  }
  if (limitationMessage) {
    return service("messenger", "Мессенджер", "limited", "Ограничено условиями аккаунта", limitationMessage, [], [], "open_repair");
  }
  return service("messenger", "Мессенджер", "available", "Готово", "Можно использовать Яндекс Мессенджер с этим Яндекс ID или подключенным токеном бота.", [], []);
}

function trackerReadiness(): Yandex360ServiceReadiness {
  return service("tracker", "Задачи", "available", "Готово", "Задачи доступны для этого рабочего аккаунта.", [], []);
}

function service(
  id: Yandex360ServiceId,
  label: string,
  status: Yandex360ServiceStatus,
  summary: string,
  detail: string,
  requiredScopes: readonly string[],
  missingScopes: string[],
  action: Yandex360ServiceReadiness["action"] = "none",
): Yandex360ServiceReadiness {
  return {
    id,
    label,
    status,
    summary,
    detail,
    requiredScopes: [...requiredScopes],
    missingScopes,
    action,
  };
}
