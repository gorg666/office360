import { platform } from "@tauri-apps/plugin-os";

export type DesktopPlatform = "windows" | "macos" | "other";

let cachedPlatform: DesktopPlatform | null = null;

export async function getDesktopPlatform(): Promise<DesktopPlatform> {
  if (cachedPlatform) return cachedPlatform;

  try {
    const current = await platform();
    cachedPlatform = current === "windows" || current === "macos" ? current : "other";
  } catch {
    cachedPlatform = "other";
  }

  return cachedPlatform;
}

export function resetDesktopPlatformCacheForTests(): void {
  cachedPlatform = null;
}
