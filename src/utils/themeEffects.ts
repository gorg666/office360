import { convertFileSrc } from "@tauri-apps/api/core";
import { getThemeById } from "@/constants/themes";
import type { ColorThemeId } from "@/constants/themes";
import type {
  WindowBackgroundLayout,
  WindowBackgroundPreset,
  WindowBackgroundSpeed,
} from "@/stores/uiStore";

type ThemeMode = "light" | "dark" | "system";

interface ThemeOptions {
  theme: ThemeMode;
  colorTheme: ColorThemeId;
}

interface WindowBackgroundOptions {
  theme: ThemeMode;
  preset: WindowBackgroundPreset;
  layout: WindowBackgroundLayout;
  speed: WindowBackgroundSpeed;
  imagePath: string;
}

const BACKGROUND_LAYOUT_CLASSES = [
  "app-bg-layout-soft",
  "app-bg-layout-diagonal",
  "app-bg-layout-corners",
  "app-bg-layout-halo",
  "app-bg-layout-minimal",
];

const BACKGROUND_SPEED_CLASSES = [
  "app-bg-speed-slow",
  "app-bg-speed-normal",
  "app-bg-speed-fast",
  "app-bg-speed-still",
];

const BACKGROUND_PALETTES: Record<
  WindowBackgroundPreset,
  {
    lightGradient: string;
    darkGradient: string;
    lightBlobs: string[];
    darkBlobs: string[];
  }
> = {
  default: {
    lightGradient: "linear-gradient(135deg, #fafafa 0%, #f5f5f5 35%, #eeeeee 70%, #ffffff 100%)",
    darkGradient: "linear-gradient(135deg, #0a0a0a 0%, #171717 45%, #262626 100%)",
    lightBlobs: ["#d4d4d4", "#d6d3d1", "#e5e5e5", "#d6d3d1", "#e5e5e5"],
    darkBlobs: ["#404040", "#2f2f2f", "#262626", "#3f3f46", "#404040"],
  },
  sunrise: {
    lightGradient: "linear-gradient(135deg, #fff7ed 0%, #fef3c7 38%, #ffe4e6 70%, #fffaf0 100%)",
    darkGradient: "linear-gradient(135deg, #1c1917 0%, #431407 48%, #4c0519 100%)",
    lightBlobs: ["#fb923c", "#facc15", "#fb7185", "#fed7aa", "#fda4af"],
    darkBlobs: ["#9a3412", "#854d0e", "#881337", "#7c2d12", "#9f1239"],
  },
  mint: {
    lightGradient: "linear-gradient(135deg, #f0fdfa 0%, #dcfce7 40%, #cffafe 74%, #ffffff 100%)",
    darkGradient: "linear-gradient(135deg, #022c22 0%, #052e16 50%, #083344 100%)",
    lightBlobs: ["#5eead4", "#86efac", "#67e8f9", "#bbf7d0", "#99f6e4"],
    darkBlobs: ["#0f766e", "#166534", "#155e75", "#064e3b", "#115e59"],
  },
  lavender: {
    lightGradient: "linear-gradient(135deg, #faf5ff 0%, #ede9fe 42%, #fce7f3 76%, #ffffff 100%)",
    darkGradient: "linear-gradient(135deg, #1e1b4b 0%, #2e1065 48%, #4c0519 100%)",
    lightBlobs: ["#c4b5fd", "#d8b4fe", "#f0abfc", "#ddd6fe", "#f9a8d4"],
    darkBlobs: ["#6d28d9", "#7e22ce", "#a21caf", "#581c87", "#9d174d"],
  },
  graphite: {
    lightGradient: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #f1f5f9 100%)",
    darkGradient: "linear-gradient(135deg, #020617 0%, #111827 50%, #334155 100%)",
    lightBlobs: ["#94a3b8", "#cbd5e1", "#64748b", "#e2e8f0", "#94a3b8"],
    darkBlobs: ["#334155", "#475569", "#1e293b", "#0f172a", "#64748b"],
  },
};

function isDarkTheme(theme: ThemeMode): boolean {
  return theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function toBlobGradient(color: string): string {
  return `radial-gradient(circle, #ffffff 0%, ${color} 50%, transparent 70%)`;
}

function toCssUrl(path: string): string {
  if (!path.trim()) return "none";
  return `url("${convertFileSrc(path).replace(/"/g, "%22")}")`;
}

export function applyColorTheme(root: HTMLElement, { theme, colorTheme }: ThemeOptions): void {
  // Every theme now writes its values explicitly. Previously "neutral" meant
  // "remove the overrides and fall through to the CSS defaults" — that stopped
  // working once the CSS defaults became the Office360 brand accent, since
  // choosing Neutral would have silently produced the brand colour.
  const themeData = getThemeById(colorTheme);
  const colors = isDarkTheme(theme) ? themeData.dark : themeData.light;
  root.style.setProperty("--color-accent", colors.accent);
  root.style.setProperty("--color-accent-hover", colors.accentHover);
  root.style.setProperty("--color-accent-light", colors.accentLight);
  root.style.setProperty("--color-bg-selected", colors.bgSelected);
  root.style.setProperty("--color-sidebar-active", colors.sidebarActive);
}

export function applyWindowBackground(root: HTMLElement, options: WindowBackgroundOptions): void {
  const palette = BACKGROUND_PALETTES[options.preset] ?? BACKGROUND_PALETTES.default;
  const dark = isDarkTheme(options.theme);
  const blobColors = dark ? palette.darkBlobs : palette.lightBlobs;

  root.classList.remove(...BACKGROUND_LAYOUT_CLASSES, ...BACKGROUND_SPEED_CLASSES);
  root.classList.add(`app-bg-layout-${options.layout}`, `app-bg-speed-${options.speed}`);
  root.classList.toggle("app-bg-has-image", Boolean(options.imagePath.trim()));

  root.style.setProperty("--app-window-gradient", dark ? palette.darkGradient : palette.lightGradient);
  root.style.setProperty("--app-background-image-url", toCssUrl(options.imagePath));
  root.style.setProperty("--app-background-image-opacity", dark ? "0.18" : "0.24");
  root.style.setProperty("--app-background-image-filter", dark ? "blur(12px) brightness(0.7)" : "blur(10px) brightness(1.18) saturate(0.75)");

  blobColors.forEach((color, index) => {
    root.style.setProperty(`--app-blob-${index + 1}`, toBlobGradient(color));
  });
}
