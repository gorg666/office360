import { normalizeEmail } from "@/utils/emailUtils";

/**
 * Имя отправителя для списка: заголовок сообщения, иначе сохранённое имя в контактах.
 */
export function effectiveFromName(
  fromName: string | null | undefined,
  fromAddress: string | null | undefined,
  contactDisplayNames: Map<string, string>,
): string | null {
  const headerName = fromName?.trim();
  if (headerName) return headerName;
  const addr = fromAddress?.trim();
  if (!addr) return null;
  return contactDisplayNames.get(normalizeEmail(addr)) ?? null;
}

export interface ThreadSenderContext {
  fromName: string | null | undefined;
  fromAddress: string | null | undefined;
}

/**
 * Подпись отправителя в цепочке: заголовок, контакты, затем имя с карточки цепи
 * (как в списке), и только потом адрес.
 */
export function resolveMessageSenderDisplay(
  fromName: string | null | undefined,
  fromAddress: string | null | undefined,
  contactDisplayNames: Map<string, string>,
  thread?: ThreadSenderContext | null,
): string {
  const fromContact = effectiveFromName(fromName, fromAddress, contactDisplayNames);
  if (fromContact) return fromContact;
  if (
    thread?.fromAddress &&
    fromAddress &&
    normalizeEmail(thread.fromAddress) === normalizeEmail(fromAddress) &&
    thread.fromName?.trim()
  ) {
    return thread.fromName.trim();
  }
  if (fromName?.trim()) return fromName.trim();
  if (fromAddress?.trim()) return fromAddress.trim();
  return "Unknown";
}

/** Имя для сайдбара контакта: без fallback на локальную часть email. */
export function resolveContactHeaderName(
  fromName: string | null | undefined,
  fromAddress: string | null | undefined,
  contactDisplayNames: Map<string, string>,
  thread?: ThreadSenderContext | null,
): string | null {
  const fromContact = effectiveFromName(fromName, fromAddress, contactDisplayNames);
  if (fromContact) return fromContact;
  if (
    thread?.fromAddress &&
    fromAddress &&
    normalizeEmail(thread.fromAddress) === normalizeEmail(fromAddress) &&
    thread.fromName?.trim()
  ) {
    return thread.fromName.trim();
  }
  if (fromName?.trim()) return fromName.trim();
  return null;
}
