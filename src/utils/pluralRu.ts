/**
 * Russian plural form picker (one / few / many).
 * Example: pluralRu(n, "письмо", "письма", "писем")
 */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatCountRu(n: number, one: string, few: string, many: string): string {
  return `${n} ${pluralRu(n, one, few, many)}`;
}
