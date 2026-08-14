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

export function isTelemostJoinUrl(value: string): boolean {
  return /^https:\/\/telemost(?:\.360)?\.yandex\.ru\/j\/[^/?#]+/i.test(value);
}

export async function openTelemostMeeting(
  platform: DesktopPlatform,
  joinUrl: string,
  accountKey?: string,
  bounds?: TelemostSurfaceBounds,
): Promise<"cef" | "wkwebview-embedded" | "wkwebview" | "browser"> {
  if (!isTelemostJoinUrl(joinUrl)) throw new Error("Введите корректную ссылку на встречу Телемоста.");
  if (platform === "windows") {
    await cefNavigate(joinUrl);
    return "cef";
  }
  if (platform === "macos") {
    if (!accountKey) throw new Error("Telemost account profile is unavailable");
    if (bounds) {
      try {
        await invoke("open_telemost_macos_embedded", { url: joinUrl, accountKey, bounds });
        return "wkwebview-embedded";
      } catch (error) {
        console.error("Embedded Telemost failed; falling back to standalone WKWebView:", error);
      }
    }
    await invoke("open_telemost_macos_spike", { url: joinUrl, accountKey });
    return "wkwebview";
  }
  await openUrl(joinUrl);
  return "browser";
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
