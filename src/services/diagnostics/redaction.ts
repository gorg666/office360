const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_VALUE_SECRET_PATTERN = /(access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|passwd|pwd|secret)\s*[:=]\s*["']?[^"',\s}]+/gi;
const JSON_SECRET_PATTERN = /("?(?:access_token|refresh_token|id_token|client_secret|password|imap_password|caldav_password)"?\s*:\s*)"?[^",}]+("?)/gi;

const RAW_MAIL_PATTERNS = [
  /^from:\s.+$/gim,
  /^to:\s.+$/gim,
  /^subject:\s.+$/gim,
  /^received:\s.+$/gim,
  /^content-type:\s.+$/gim,
  /-{2,}[A-Za-z0-9_=-]{8,}-{2,}/g,
];

const MAX_REDACTED_LENGTH = 600;

export function redactDiagnosticText(value: unknown): string {
  let text = value instanceof Error ? value.message : String(value ?? "");
  text = text.replace(BEARER_PATTERN, "Bearer [redacted]");
  text = text.replace(KEY_VALUE_SECRET_PATTERN, (_match, key: string) => `${key}=[redacted]`);
  text = text.replace(JSON_SECRET_PATTERN, (_match, prefix: string, suffix: string | undefined) => `${prefix}"[redacted]${suffix ?? ""}`);
  for (const pattern of RAW_MAIL_PATTERNS) {
    text = text.replace(pattern, "[redacted-mail]");
  }
  text = text.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > MAX_REDACTED_LENGTH) {
    return `${text.slice(0, MAX_REDACTED_LENGTH)}...`;
  }
  return text;
}

export function redactDebugBundleValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactDiagnosticText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDebugBundleValue(item)) as T;
  }
  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/token|password|secret|raw|body|mime/i.test(key)) {
        redacted[key] = "[redacted]";
      } else {
        redacted[key] = redactDebugBundleValue(item);
      }
    }
    return redacted as T;
  }
  return value;
}
