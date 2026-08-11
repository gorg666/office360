import { useEffect, useState } from "react";
import { Composer } from "./components/composer/Composer";
import { useAccountStore } from "./stores/accountStore";
import { useComposerStore } from "./stores/composerStore";
import { useUIStore } from "./stores/uiStore";
import { runMigrations } from "./services/db/migrations";
import { getAllAccounts } from "./services/db/accounts";
import { getSetting } from "./services/db/settings";
import { initializeClients } from "./services/gmail/tokenManager";
import { COLOR_THEMES } from "./constants/themes";
import type { ColorThemeId } from "./constants/themes";
import type { ComposerMode } from "./stores/composerStore";
import { applyColorTheme, applyWindowBackground } from "./utils/themeEffects";
import { ComposerEditorContextMenuPortal } from "./components/composer/ComposerEditorContextMenu";
import { useSuppressBrowserContextMenu } from "./hooks/useSuppressBrowserContextMenu";

export default function ComposerWindow() {
  const { setTheme, setFontScale, setColorTheme } = useUIStore();
  const { setAccounts } = useAccountStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useSuppressBrowserContextMenu();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    async function init() {
      try {
        await runMigrations();

        // Restore theme
        const savedTheme = await getSetting("theme");
        if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "system") {
          setTheme(savedTheme);
        }

        // Restore font scale
        const savedFontScale = await getSetting("font_size");
        if (savedFontScale === "small" || savedFontScale === "default" || savedFontScale === "large" || savedFontScale === "xlarge") {
          setFontScale(savedFontScale);
        }

        // Restore color theme
        const savedColorTheme = await getSetting("color_theme");
        if (savedColorTheme && COLOR_THEMES.some((t) => t.id === savedColorTheme)) {
          setColorTheme(savedColorTheme as ColorThemeId);
        }

        const ui = useUIStore.getState();
        const savedBackgroundPreset = await getSetting("window_background_preset");
        if (savedBackgroundPreset === "default" || savedBackgroundPreset === "sunrise" || savedBackgroundPreset === "mint" || savedBackgroundPreset === "lavender" || savedBackgroundPreset === "graphite") {
          ui.setWindowBackgroundPreset(savedBackgroundPreset);
        }
        const savedBackgroundLayout = await getSetting("window_background_layout");
        if (savedBackgroundLayout === "soft" || savedBackgroundLayout === "diagonal" || savedBackgroundLayout === "corners" || savedBackgroundLayout === "halo" || savedBackgroundLayout === "minimal") {
          ui.setWindowBackgroundLayout(savedBackgroundLayout);
        }
        const savedBackgroundSpeed = await getSetting("window_background_speed");
        if (savedBackgroundSpeed === "slow" || savedBackgroundSpeed === "normal" || savedBackgroundSpeed === "fast" || savedBackgroundSpeed === "still") {
          ui.setWindowBackgroundSpeed(savedBackgroundSpeed);
        }
        const savedBackgroundImage = await getSetting("window_background_image_path");
        if (savedBackgroundImage) ui.setWindowBackgroundImagePath(savedBackgroundImage);

        // Load accounts into store
        const dbAccounts = await getAllAccounts();
        const mapped = dbAccounts.map((a) => ({
          id: a.id,
          email: a.email,
          displayName: a.display_name,
          avatarUrl: a.avatar_url,
          isActive: a.is_active === 1,
          provider: a.provider,
        }));
        const savedAccountId = await getSetting("active_account_id");
        setAccounts(mapped, savedAccountId);

        // Parse composer state from URL params
        const mode = (params.get("mode") as ComposerMode) ?? "new";
        const to = params.get("to")?.split(",").filter(Boolean) ?? [];
        const cc = params.get("cc")?.split(",").filter(Boolean) ?? [];
        const bcc = params.get("bcc")?.split(",").filter(Boolean) ?? [];
        const subject = params.get("subject") ?? "";
        const threadId = params.get("threadId") ?? null;
        const inReplyToMessageId = params.get("inReplyToMessageId") ?? null;
        const draftId = params.get("draftId") ?? null;
        const fromEmail = params.get("fromEmail");

        // Decode base64 body
        let bodyHtml = "";
        const bodyParam = params.get("body");
        if (bodyParam) {
          try {
            bodyHtml = decodeURIComponent(escape(atob(bodyParam)));
          } catch {
            bodyHtml = "";
          }
        }

        // Open composer with parsed state
        useComposerStore.getState().openComposer({
          mode,
          to,
          cc,
          bcc,
          subject,
          bodyHtml,
          threadId,
          inReplyToMessageId,
          draftId,
        });

        // Set fromEmail and force fullpage mode
        if (fromEmail) {
          useComposerStore.getState().setFromEmail(fromEmail);
        }
        useComposerStore.getState().setViewMode("fullpage");
        setLoading(false);

        initializeClients().catch((err) => {
          console.warn("Failed to initialize clients in composer window:", err);
        });
      } catch (err) {
        console.error("Failed to initialize composer window:", err);
        setError("Failed to load composer");
        setLoading(false);
      }
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store setters are stable references
  }, []);

  // Sync theme class to <html>
  const theme = useUIStore((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = () => {
        if (mq.matches) root.classList.add("dark");
        else root.classList.remove("dark");
      };
      apply();
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  // Sync font-scale class to <html>
  const fontScale = useUIStore((s) => s.fontScale);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("font-scale-small", "font-scale-default", "font-scale-large", "font-scale-xlarge");
    root.classList.add(`font-scale-${fontScale}`);
  }, [fontScale]);

  // Apply color theme CSS custom properties to <html>
  const colorTheme = useUIStore((s) => s.colorTheme);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => applyColorTheme(root, { theme, colorTheme });

    apply();

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [colorTheme, theme]);

  const windowBackgroundPreset = useUIStore((s) => s.windowBackgroundPreset);
  const windowBackgroundLayout = useUIStore((s) => s.windowBackgroundLayout);
  const windowBackgroundSpeed = useUIStore((s) => s.windowBackgroundSpeed);
  const windowBackgroundImagePath = useUIStore((s) => s.windowBackgroundImagePath);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      applyWindowBackground(root, {
        theme,
        preset: windowBackgroundPreset,
        layout: windowBackgroundLayout,
        speed: windowBackgroundSpeed,
        imagePath: windowBackgroundImagePath,
      });
    };
    apply();
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme, windowBackgroundPreset, windowBackgroundLayout, windowBackgroundSpeed, windowBackgroundImagePath]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-primary text-text-secondary">
        <span className="text-sm">Loading composer...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-primary text-text-secondary">
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary">
      <div className="animated-bg" aria-hidden="true">
        <div className="blob" />
        <div className="blob" />
        <div className="blob" />
        <div className="blob" />
        <div className="blob" />
      </div>
      <Composer />
      <UndoSendToast />
      <ComposerEditorContextMenuPortal />
    </div>
  );
}
