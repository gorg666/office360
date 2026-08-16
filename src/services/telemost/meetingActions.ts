import { invoke } from "@tauri-apps/api/core";
import { cefNavigate } from "@/services/cef";
import type { DesktopPlatform } from "@/utils/desktopPlatform";
import { openTelemostCreateInBrowser, TELEMOST_CREATE_URL, type TelemostSurfaceBounds } from "./meetingRenderer";

export async function createTelemostMeetingWeb(
  platform: DesktopPlatform,
  accountKey?: string,
  bounds?: TelemostSurfaceBounds,
): Promise<"cef" | "wkwebview" | "browser"> {
  if (platform === "windows") {
    await cefNavigate(TELEMOST_CREATE_URL);
    return "cef";
  }
  if (platform === "macos") {
    if (!accountKey) throw new Error("Telemost account profile is unavailable");
    if (!bounds) throw new Error("Embedded Telemost bounds are unavailable");
    await invoke("open_telemost_macos_embedded", { url: TELEMOST_CREATE_URL, accountKey, bounds });
    return "wkwebview";
  }
  await openTelemostCreateInBrowser();
  return "browser";
}
