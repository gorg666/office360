import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cefNavigate } from "@/services/cef";
import type { DesktopPlatform } from "@/utils/desktopPlatform";

export type TelemostSurfaceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const TELEMOST_CREATE_URL = "https://telemost.yandex.ru/?browser-auto-create=1";

export function isTelemostJoinUrl(value: string): boolean {
  return /^https:\/\/telemost(?:\.360)?\.yandex\.ru\/j\/[^/?#]+/i.test(value);
}

export function isTelemostCreateUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && /^telemost(?:\.360)?\.yandex\.ru$/i.test(parsed.hostname)
      && (parsed.pathname === "/" || parsed.pathname === "");
  } catch {
    return false;
  }
}

export function isTelemostEmbeddedUrl(value: string): boolean {
  return isTelemostJoinUrl(value) || isTelemostCreateUrl(value);
}

export async function openTelemostEmbedded(
  platform: DesktopPlatform,
  url: string,
  accountKey?: string,
  bounds?: TelemostSurfaceBounds,
  epoch?: number,
): Promise<"cef" | "wkwebview-embedded" | "browser"> {
  if (!isTelemostEmbeddedUrl(url)) throw new Error("Введите корректную ссылку на встречу Телемоста.");
  if (platform === "windows") {
    await cefNavigate(url);
    return "cef";
  }
  if (platform === "macos") {
    if (!accountKey) throw new Error("Telemost account profile is unavailable");
    if (!bounds) throw new Error("Embedded Telemost bounds are unavailable");
    await invoke("open_telemost_macos_embedded", {
      url,
      accountKey,
      bounds,
      ...(epoch != null ? { epoch } : {}),
    });
    return "wkwebview-embedded";
  }
  await openUrl(isTelemostJoinUrl(url) ? url : "https://telemost.yandex.ru/");
  return "browser";
}

export async function openTelemostMeeting(
  platform: DesktopPlatform,
  joinUrl: string,
  accountKey?: string,
  bounds?: TelemostSurfaceBounds,
  epoch?: number,
): Promise<"cef" | "wkwebview-embedded" | "browser"> {
  if (!isTelemostJoinUrl(joinUrl)) throw new Error("Введите корректную ссылку на встречу Телемоста.");
  return openTelemostEmbedded(platform, joinUrl, accountKey, bounds, epoch);
}

export async function setTelemostEmbeddedBounds(bounds: TelemostSurfaceBounds): Promise<void> {
  await invoke("set_telemost_macos_embedded_bounds", { bounds });
}

export async function closeTelemostEmbedded(): Promise<void> {
  await invoke("close_telemost_macos_embedded");
}

export async function openTelemostInBrowser(joinUrl: string): Promise<void> {
  if (!isTelemostJoinUrl(joinUrl)) throw new Error("Введите корректную ссылку на встречу Телемоста.");
  await openUrl(joinUrl);
}

export async function openTelemostCreateInBrowser(): Promise<void> {
  await openUrl("https://telemost.yandex.ru/");
}
