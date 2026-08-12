import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cefNavigate } from "@/services/cef";
import type { DesktopPlatform } from "@/utils/desktopPlatform";

export function isTelemostJoinUrl(value: string): boolean {
  return /^https:\/\/telemost(?:\.360)?\.yandex\.ru\/j\/[^/?#]+/i.test(value);
}

export async function openTelemostMeeting(platform: DesktopPlatform, joinUrl: string, accountKey?: string): Promise<"cef" | "wkwebview" | "browser"> {
  if (!isTelemostJoinUrl(joinUrl)) throw new Error("Введите корректную ссылку на встречу Телемоста.");
  if (platform === "windows") { await cefNavigate(joinUrl); return "cef"; }
  if (platform === "macos") {
    if (!accountKey) throw new Error("Telemost account profile is unavailable");
    await invoke("open_telemost_macos_spike", { url: joinUrl, accountKey });
    return "wkwebview";
  }
  await openUrl(joinUrl); return "browser";
}

export async function openTelemostInBrowser(joinUrl: string): Promise<void> {
  if (!isTelemostJoinUrl(joinUrl)) throw new Error("Введите корректную ссылку на встречу Телемоста.");
  await openUrl(joinUrl);
}

export async function openTelemostCreateInBrowser(): Promise<void> {
  await openUrl("https://telemost.yandex.ru/");
}
