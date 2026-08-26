import { create } from "zustand";
import { setSetting } from "@/services/db/settings";
import type { ColorThemeId } from "@/constants/themes";

type Theme = "light" | "dark" | "system";
type ReadingPanePosition = "right" | "bottom" | "hidden";
type ReadFilter = "all" | "read" | "unread";
export type EmailDensity = "compact" | "default" | "spacious";
export type DefaultReplyMode = "reply" | "replyAll";
export type MarkAsReadBehavior = "instant" | "2s" | "manual";
export type FontScale = "small" | "default" | "large" | "xlarge";
export type InboxViewMode = "unified" | "split";
export type AppLocale = "en" | "ru";
export type WindowBackgroundPreset = "default" | "sunrise" | "mint" | "lavender" | "graphite";
export type WindowBackgroundLayout = "soft" | "diagonal" | "corners" | "halo" | "minimal";
export type WindowBackgroundSpeed = "slow" | "normal" | "fast" | "still";

export interface SidebarNavItem {
  id: string;
  visible: boolean;
}

interface UIState {
  theme: Theme;
  sidebarCollapsed: boolean;
  contactSidebarVisible: boolean;
  readingPanePosition: ReadingPanePosition;
  readFilter: ReadFilter;
  emailListWidth: number;
  emailDensity: EmailDensity;
  defaultReplyMode: DefaultReplyMode;
  markAsReadBehavior: MarkAsReadBehavior;
  fontScale: FontScale;
  colorTheme: ColorThemeId;
  windowBackgroundPreset: WindowBackgroundPreset;
  windowBackgroundLayout: WindowBackgroundLayout;
  windowBackgroundSpeed: WindowBackgroundSpeed;
  windowBackgroundImagePath: string;
  sendAndArchive: boolean;
  inboxViewMode: InboxViewMode;
  taskSidebarVisible: boolean;
  sidebarNavConfig: SidebarNavItem[] | null;
  reduceMotion: boolean;
  locale: AppLocale;
  isOnline: boolean;
  pendingOpsCount: number;
  isSyncingFolder: string | null;
  /** Две колонки мессенджера справа от почты (Starred/Sent и т.д.). */
  messengersPanelsOpen: boolean;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleContactSidebar: () => void;
  setContactSidebarVisible: (visible: boolean) => void;
  setReadingPanePosition: (position: ReadingPanePosition) => void;
  setReadFilter: (filter: ReadFilter) => void;
  setEmailListWidth: (width: number) => void;
  setEmailDensity: (density: EmailDensity) => void;
  setDefaultReplyMode: (mode: DefaultReplyMode) => void;
  setMarkAsReadBehavior: (behavior: MarkAsReadBehavior) => void;
  setFontScale: (scale: FontScale) => void;
  setColorTheme: (theme: ColorThemeId) => void;
  setWindowBackgroundPreset: (preset: WindowBackgroundPreset) => void;
  setWindowBackgroundLayout: (layout: WindowBackgroundLayout) => void;
  setWindowBackgroundSpeed: (speed: WindowBackgroundSpeed) => void;
  setWindowBackgroundImagePath: (path: string) => void;
  setSendAndArchive: (enabled: boolean) => void;
  setInboxViewMode: (mode: InboxViewMode) => void;
  toggleTaskSidebar: () => void;
  setTaskSidebarVisible: (visible: boolean) => void;
  setSidebarNavConfig: (config: SidebarNavItem[]) => void;
  restoreSidebarNavConfig: (config: SidebarNavItem[]) => void;
  setReduceMotion: (reduce: boolean) => void;
  setLocale: (locale: AppLocale) => void;
  restoreLocale: (locale: AppLocale) => void;
  setOnline: (online: boolean) => void;
  setPendingOpsCount: (count: number) => void;
  setSyncingFolder: (folder: string | null) => void;
  setMessengersPanelsOpen: (open: boolean) => void;
  toggleMessengersPanels: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: "system",
  sidebarCollapsed: false,
  contactSidebarVisible: true,
  readingPanePosition: "right",
  readFilter: "all",
  emailListWidth: 320,
  emailDensity: "default",
  defaultReplyMode: "reply",
  markAsReadBehavior: "instant",
  fontScale: "default",
  colorTheme: "office360",
  windowBackgroundPreset: "default",
  windowBackgroundLayout: "soft",
  windowBackgroundSpeed: "normal",
  windowBackgroundImagePath: "",
  sendAndArchive: false,
  inboxViewMode: "unified",
  taskSidebarVisible: false,
  sidebarNavConfig: null,
  reduceMotion: false,
  locale: "ru",
  isOnline: true,
  pendingOpsCount: 0,
  isSyncingFolder: null,
  messengersPanelsOpen: false,

  setTheme: (theme) => set({ theme }),
  toggleSidebar: () =>
    set((state) => {
      const collapsed = !state.sidebarCollapsed;
      setSetting("sidebar_collapsed", String(collapsed)).catch(() => {});
      return { sidebarCollapsed: collapsed };
    }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleContactSidebar: () =>
    set((state) => {
      const visible = !state.contactSidebarVisible;
      setSetting("contact_sidebar_visible", String(visible)).catch(() => {});
      return { contactSidebarVisible: visible };
    }),
  setContactSidebarVisible: (contactSidebarVisible) => set({ contactSidebarVisible }),
  setReadingPanePosition: (readingPanePosition) => {
    setSetting("reading_pane_position", readingPanePosition).catch(() => {});
    set({ readingPanePosition });
  },
  setReadFilter: (readFilter) => {
    setSetting("read_filter", readFilter).catch(() => {});
    set({ readFilter });
  },
  setEmailListWidth: (emailListWidth) => {
    setSetting("email_list_width", String(emailListWidth)).catch(() => {});
    set({ emailListWidth });
  },
  setEmailDensity: (emailDensity) => {
    setSetting("email_density", emailDensity).catch(() => {});
    set({ emailDensity });
  },
  setDefaultReplyMode: (defaultReplyMode) => {
    setSetting("default_reply_mode", defaultReplyMode).catch(() => {});
    set({ defaultReplyMode });
  },
  setMarkAsReadBehavior: (markAsReadBehavior) => {
    setSetting("mark_as_read_behavior", markAsReadBehavior).catch(() => {});
    set({ markAsReadBehavior });
  },
  setFontScale: (fontScale) => {
    setSetting("font_size", fontScale).catch(() => {});
    set({ fontScale });
  },
  setColorTheme: (colorTheme) => {
    setSetting("color_theme", colorTheme).catch(() => {});
    set({ colorTheme });
  },
  setWindowBackgroundPreset: (windowBackgroundPreset) => {
    setSetting("window_background_preset", windowBackgroundPreset).catch(() => {});
    set({ windowBackgroundPreset });
  },
  setWindowBackgroundLayout: (windowBackgroundLayout) => {
    setSetting("window_background_layout", windowBackgroundLayout).catch(() => {});
    set({ windowBackgroundLayout });
  },
  setWindowBackgroundSpeed: (windowBackgroundSpeed) => {
    setSetting("window_background_speed", windowBackgroundSpeed).catch(() => {});
    set({ windowBackgroundSpeed });
  },
  setWindowBackgroundImagePath: (windowBackgroundImagePath) => {
    setSetting("window_background_image_path", windowBackgroundImagePath).catch(() => {});
    set({ windowBackgroundImagePath });
  },
  setSendAndArchive: (sendAndArchive) => {
    setSetting("send_and_archive", String(sendAndArchive)).catch(() => {});
    set({ sendAndArchive });
  },
  setInboxViewMode: (inboxViewMode) => {
    setSetting("inbox_view_mode", inboxViewMode).catch(() => {});
    set({ inboxViewMode });
  },
  toggleTaskSidebar: () =>
    set((state) => {
      const visible = !state.taskSidebarVisible;
      setSetting("task_sidebar_visible", String(visible)).catch(() => {});
      return { taskSidebarVisible: visible };
    }),
  setTaskSidebarVisible: (taskSidebarVisible) => set({ taskSidebarVisible }),
  setSidebarNavConfig: (sidebarNavConfig) => {
    setSetting("sidebar_nav_config", JSON.stringify(sidebarNavConfig)).catch(() => {});
    set({ sidebarNavConfig });
  },
  restoreSidebarNavConfig: (sidebarNavConfig) => set({ sidebarNavConfig }),
  setReduceMotion: (reduceMotion) => {
    setSetting("reduce_motion", String(reduceMotion)).catch(() => {});
    set({ reduceMotion });
  },
  setLocale: (locale) => {
    setSetting("ui_locale", locale).catch(() => {});
    localStorage.setItem("ui_locale", locale);
    set({ locale });
  },
  restoreLocale: (locale) => {
    localStorage.setItem("ui_locale", locale);
    set({ locale });
  },
  setOnline: (isOnline) => set({ isOnline }),
  setPendingOpsCount: (pendingOpsCount) => set({ pendingOpsCount }),
  setSyncingFolder: (isSyncingFolder) => set({ isSyncingFolder }),
  setMessengersPanelsOpen: (messengersPanelsOpen) => {
    setSetting("messengers_panels_open", String(messengersPanelsOpen)).catch(() => {});
    set({ messengersPanelsOpen });
  },
  toggleMessengersPanels: () =>
    set((state) => {
      const open = !state.messengersPanelsOpen;
      setSetting("messengers_panels_open", String(open)).catch(() => {});
      return { messengersPanelsOpen: open };
    }),
}));
