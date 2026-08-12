import { invoke } from "@tauri-apps/api/core";
import { cefNavigate } from "@/services/cef";
import type { DesktopPlatform } from "@/utils/desktopPlatform";
import { openTelemostCreateInBrowser } from "./meetingRenderer";

export async function createTelemostMeetingWeb(platform: DesktopPlatform, accountKey?: string): Promise<"cef" | "wkwebview" | "browser"> {
  if (platform === "windows") {
    await cefNavigate("https://telemost.yandex.ru/?browser-auto-create=1");
    return "cef";
  }
  if (platform === "macos") {
    if (!accountKey) throw new Error("Telemost account profile is unavailable");
    await invoke("open_telemost_macos_create", { accountKey });
    return "wkwebview";
  }
  await openTelemostCreateInBrowser();
  return "browser";
}
