const STORAGE_KEY = "velo_yandex_messenger_update_offset:v1";

function readMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // best-effort
  }
}

/** Ключ сессии: account:&lt;id&gt; или manual:&lt;префикс токена&gt;. */
export function loadYandexMessengerUpdateOffset(sourceKey: string): number {
  const v = readMap()[sourceKey];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

export function saveYandexMessengerUpdateOffset(sourceKey: string, offset: number): void {
  const map = readMap();
  map[sourceKey] = offset;
  writeMap(map);
}
