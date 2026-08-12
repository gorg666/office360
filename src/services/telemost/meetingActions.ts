import { invoke } from "@tauri-apps/api/core";
import { cefNavigate } from "@/services/cef";
import type { DesktopPlatform } from "@/utils/desktopPlatform";
import { openTelemostCreateInBrowser } from "./meetingRenderer";

export async function createTelemostMeetingWeb(platform: DesktopPlatform): Promise<"cef" | "wkwebview" | "browser"> {
  if (platform === "windows") {
    await cefNavigate("https://telemost.yandex.ru/?browser-auto-create=1");
    return "cef";
  }
  if (platform === "macos") {
    await invoke("open_telemost_macos_create");
    return "wkwebview";
  }
  await openTelemostCreateInBrowser();
  return "browser";
}
