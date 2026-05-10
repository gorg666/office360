import { decodeMimeWords } from "@/utils/mimeHeaderDecode";
import { normalizeEmail } from "@/utils/emailUtils";

/** Один адрес из From / To / Cc (после декодирования RFC 2047). */
export function parseSingleEmailAddress(raw: string | null | undefined): { name: string | null; address: string | null } {
  if (!raw?.trim()) return { name: null, address: null };
  const normalized = (decodeMimeWords(raw.trim()) ?? raw).trim();

  // "Display Name" <user@host> — ищем последнюю пару <...>, чтобы не ломаться на кавычках в имени.
  const gt = normalized.lastIndexOf(">");
  if (gt > 0) {
    const lt = normalized.lastIndexOf("<", gt);
    if (lt >= 0) {
      const address = normalized.slice(lt + 1, gt).trim();
      let namePart = normalized.slice(0, lt).trim();
      if (namePart.startsWith('"') && namePart.endsWith('"') && namePart.length >= 2) {
        namePart = namePart.slice(1, -1).replace(/\\"/g, '"').trim();
      }
      const addrNorm = address ? normalizeEmail(address) : "";
      const nameLooksLikeEmail = /^[^\s@]+@[^\s@]+$/.test(namePart);
      const name =
        namePart.length > 0 &&
        (!nameLooksLikeEmail || normalizeEmail(namePart) !== addrNorm)
          ? namePart
          : null;
      return {
        name,
        address: address.length > 0 ? address : null,
      };
    }
  }

  // Устаревший формат RFC: mailbox@domain (Comment / display)
  const paren = normalized.match(/^([^\s<>()]+@[^\s<>()]+)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    const address = paren[1]!.trim();
    const comment = paren[2]!.trim();
    const addrNorm = normalizeEmail(address);
    const nameLooksLikeEmail = /^[^\s@]+@[^\s@]+$/.test(comment);
    const name =
      comment.length > 0 && (!nameLooksLikeEmail || normalizeEmail(comment) !== addrNorm)
        ? comment
        : null;
    return { name, address };
  }

  const bare = normalized.replace(/^<|>$/g, "").trim();
  if (/^[^\s@]+@[^\s@]+$/.test(bare)) {
    return { name: null, address: bare };
  }

  return { name: null, address: bare || null };
}

/**
 * Первый адрес из списка To/Cc (учёт кавычек и угловых скобок).
 */
export function parseFirstAddressFromList(listRaw: string | null | undefined): { name: string | null; address: string | null } {
  if (!listRaw?.trim()) return { name: null, address: null };
  const decoded = decodeMimeWords(listRaw.trim()) ?? listRaw.trim();

  let depth = 0;
  let inQuote = false;
  let start = 0;

  for (let i = 0; i <= decoded.length; i++) {
    const c = decoded[i];
    const atEnd = i === decoded.length;

    if (
      atEnd
      || (c === "," && depth === 0 && !inQuote)
    ) {
      const segment = decoded.slice(start, i).trim();
      if (segment) {
        const parsed = parseSingleEmailAddress(segment);
        if (parsed.address) return parsed;
      }
      start = i + 1;
      continue;
    }

    if (c === '"' && decoded[i - 1] !== "\\") {
      inQuote = !inQuote;
    }
    if (!inQuote) {
      if (c === "<") depth += 1;
      if (c === ">") depth = Math.max(0, depth - 1);
    }
  }

  return { name: null, address: null };
}
