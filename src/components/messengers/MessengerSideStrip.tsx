import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  Bot,
  Check,
  Contact,
  File as FileIcon,
  Hash,
  Image,
  LogOut,
  MessageCircle,
  Moon,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Video,
  X,
  Users,
} from "lucide-react";
import type { MessengerAttachmentUpload, MessengerConversation, MessengerConversationKind, MessengerMessage } from "@/services/messengers/botApiTypes";
import {
  clearMessengerCredentials,
  loadMessengerCredentials,
  loadMessengerTargets,
  maskMessengerToken,
  saveMessengerCredentials,
  saveMessengerTarget,
  type MessengerCredentials,
  type MessengerProviderId,
} from "@/services/messengers/credentials";
import {
  fetchYandexMessengerUpdates,
  getYandexConversations,
  getYandexUserLink,
  hydrateYandexMessageAttachments,
  mergeYandexConversationFromUpdate,
  messengerMessageFromYandexUpdate,
  nextYandexUpdateOffset,
  sendYandexMessage,
} from "@/services/messengers/yandexBotApi";
import { loadYandexMessengerUpdateOffset, saveYandexMessengerUpdateOffset } from "@/services/messengers/yandexMessengerOffset";
import {
  resolveYandexMessengerSession,
  yandexMessengerSourceKey,
  type YandexMessengerSession,
} from "@/services/messengers/yandexMessengerSession";
import { generateYandexMessengerAiReply } from "@/services/messengers/yandexAiAutoReply";
import { executeYandexAssistantTools } from "@/services/messengers/yandexAssistantTools";
import { YandexMessengerWidget } from "./YandexMessengerWidget";
import {
  applyMessengerProviderTab,
  DEFAULT_MESSENGER_PROVIDER,
  MESSENGER_PROVIDER_TABS,
} from "./messengerProviderSelection";
import { useAccountStore } from "@/stores/accountStore";
import { useUIStore } from "@/stores/uiStore";
import {
  checkMaxPassword,
  checkMaxAuthCode,
  connectMaxClient,
  disconnectMaxClient,
  completeMaxRegistration,
  getMaxConversations,
  getMaxMe,
  getMaxMessages,
  normalizeMaxClientEvent,
  sendMaxMessage,
  startMaxAuth,
} from "@/services/messengers/maxBotApi";
const LIGHTS_OUT_UNTIL_KEY = "velo_messenger_lights_out_until";
const LIGHTS_OUT_CHANGED_EVENT = "velo-messenger-lights-out-changed";
const MAX_CONVERSATIONS_CACHE_KEY = "velo_max_conversations:v1";
const MAX_MESSAGES_CACHE_KEY = "velo_max_messages:v1";
const YANDEX_AI_AUTO_REPLY_ENABLED_KEY = "velo_yandex_ai_auto_reply_enabled:v1";
const YANDEX_AI_AUTO_REPLY_SEEN_KEY = "velo_yandex_ai_auto_reply_seen:v1";
const YANDEX_AI_AUTO_REPLY_PENDING_KEY = "velo_yandex_ai_auto_reply_pending:v1";
const YANDEX_AI_AUTO_REPLY_PENDING_MESSAGES_KEY = "velo_yandex_ai_auto_reply_pending_messages:v1";

interface ProviderView {
  id: MessengerProviderId;
  name: string;
  subtitle: string;
  tokenLabel: string;
  targetHint: string;
  docUrl: string;
  iconSrc: string;
  accentClass: string;
}

const PROVIDERS: ProviderView[] = [
  {
    id: "max",
    name: "MAX",
    subtitle: "Клиентский desktop-протокол MAX",
    tokenLabel: "MAX auth token",
    targetHint: "chat_id",
    docUrl: "https://web.max.ru",
    iconSrc: "/assets/max.svg",
    accentClass: "bg-[#0b7cff]",
  },
  {
    id: "yandex",
    name: "Яндекс",
    subtitle: "Bot API Мессенджера Яндекс 360",
    tokenLabel: "Токен бота Яндекс 360",
    targetHint: "chat_id или login",
    docUrl: "https://yandex.ru/dev/messenger/doc/ru/",
    iconSrc: "/assets/yandexmess.svg",
    accentClass: "bg-[#ffcc00]",
  },
  {
    id: "telegram",
    name: "Telegram",
    subtitle: "Telegram client protocol",
    tokenLabel: "Telegram token",
    targetHint: "chat_id",
    docUrl: "https://core.telegram.org/",
    iconSrc: "/assets/telegram.svg",
    accentClass: "bg-[#229ed9]",
  },
];

type StripPaneId = "messengerList" | "messengerChat";

const DEFAULT_STRIP_ORDER: StripPaneId[] = ["messengerList", "messengerChat"];
const COLLAPSED_STRIP_PANES: StripPaneId[] = [];

const ALL_STRIP_PANE_IDS: StripPaneId[] = ["messengerList", "messengerChat"];
const LAYOUT_STORAGE_KEY = "velo_messenger_pane_layout:v2";
/** Ширины и порядок только колонок мессенджера у обычных маршрутов почты. */
const STRIP_LAYOUT_KEY = "velo_messenger_side_strip:v1";

const DEFAULT_STRIP_WIDTHS: Record<StripPaneId, number> = {
  messengerList: 360,
  messengerChat: 360,
};

const COLUMN_BORDER_CLASS = "overflow-hidden border-l border-border-primary shadow-none";
/** Ширина разделителя между колонками списка и чата (соответствует `w-3` у ручки). */
const INNER_STRIP_DIVIDER_PX = 12;

const STRIP_PANE_LIMITS: Record<StripPaneId, { min: number; max: number }> = {
  messengerList: { min: 360, max: 360 },
  messengerChat: { min: 320, max: 520 },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

interface PersistedMessengerLayout {
  paneWidths?: Partial<Record<StripPaneId, number>>;
  paneOrder?: StripPaneId[];
  collapsedPaneIds?: string[];
}

function loadMessengerPaneLayout(): PersistedMessengerLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as PersistedMessengerLayout;
  } catch {
    return {};
  }
}

function loadSideStripLayout(): PersistedMessengerLayout {
  try {
    const raw = localStorage.getItem(STRIP_LAYOUT_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as PersistedMessengerLayout;
    }
  } catch {
    // fall through to legacy full layout
  }
  const legacy = loadMessengerPaneLayout();
  const stripOrder = legacy.paneOrder?.filter((x): x is StripPaneId => ALL_STRIP_PANE_IDS.includes(x as StripPaneId));
  return {
    paneWidths: {
      messengerList: legacy.paneWidths?.messengerList,
      messengerChat: legacy.paneWidths?.messengerChat,
    },
    paneOrder: stripOrder?.length === 2 ? stripOrder : undefined,
    collapsedPaneIds: legacy.collapsedPaneIds?.filter((x): x is StripPaneId => ALL_STRIP_PANE_IDS.includes(x as StripPaneId)),
  };
}

function mergeStripWidths(persisted: Partial<Record<StripPaneId, number>> | undefined): Record<StripPaneId, number> {
  const merged = { ...DEFAULT_STRIP_WIDTHS };
  if (!persisted) return merged;
  for (const id of ALL_STRIP_PANE_IDS) {
    const v = persisted[id];
    if (typeof v === "number" && Number.isFinite(v)) {
      const { min, max } = STRIP_PANE_LIMITS[id];
      merged[id] = clamp(v, min, max);
    }
  }
  return merged;
}

function isLightsOutActive() {
  try {
    const value = localStorage.getItem(LIGHTS_OUT_UNTIL_KEY);
    return value ? Date.now() < Number(value) : false;
  } catch {
    return false;
  }
}

function loadYandexAiAutoReplyEnabled() {
  try {
    return localStorage.getItem(YANDEX_AI_AUTO_REPLY_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveYandexAiAutoReplyEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(YANDEX_AI_AUTO_REPLY_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // best-effort
  }
}

function loadYandexAiRepliedMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(YANDEX_AI_AUTO_REPLY_SEEN_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string[]>;
  } catch {
    return {};
  }
}

function loadYandexAiRepliedIds(sourceKey: string): Set<string> {
  const ids = loadYandexAiRepliedMap()[sourceKey];
  return new Set(Array.isArray(ids) ? ids : []);
}

function saveYandexAiRepliedIds(sourceKey: string, ids: Set<string>): void {
  try {
    const map = loadYandexAiRepliedMap();
    map[sourceKey] = [...ids].slice(-500);
    localStorage.setItem(YANDEX_AI_AUTO_REPLY_SEEN_KEY, JSON.stringify(map));
  } catch {
    // best-effort
  }
}

function loadYandexAiPendingMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(YANDEX_AI_AUTO_REPLY_PENDING_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string[]>;
  } catch {
    return {};
  }
}

function loadYandexAiPendingIds(sourceKey: string): Set<string> {
  const ids = loadYandexAiPendingMap()[sourceKey];
  return new Set(Array.isArray(ids) ? ids : []);
}

function saveYandexAiPendingIds(sourceKey: string, ids: Set<string>): void {
  try {
    const map = loadYandexAiPendingMap();
    map[sourceKey] = [...ids].slice(-200);
    localStorage.setItem(YANDEX_AI_AUTO_REPLY_PENDING_KEY, JSON.stringify(map));
  } catch {
    // best-effort
  }
}

function loadYandexAiPendingMessageMap(): Record<string, MessengerMessage[]> {
  try {
    const raw = localStorage.getItem(YANDEX_AI_AUTO_REPLY_PENDING_MESSAGES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, MessengerMessage[]>;
  } catch {
    return {};
  }
}

function loadYandexAiPendingMessages(sourceKey: string): MessengerMessage[] {
  const messages = loadYandexAiPendingMessageMap()[sourceKey];
  return Array.isArray(messages) ? messages : [];
}

function saveYandexAiPendingMessages(sourceKey: string, messages: MessengerMessage[]): void {
  try {
    const map = loadYandexAiPendingMessageMap();
    map[sourceKey] = mergeMessages(messages).slice(-200);
    localStorage.setItem(YANDEX_AI_AUTO_REPLY_PENDING_MESSAGES_KEY, JSON.stringify(map));
  } catch {
    // best-effort
  }
}

function isRobotMessengerMessage(message: MessengerMessage): boolean {
  const raw = message.raw;
  if (!raw || typeof raw !== "object") return false;
  const from = (raw as { from?: { robot?: boolean } }).from;
  return from?.robot === true;
}

function endOfDayTimestamp() {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

function formatMessageTime(timestamp?: number) {
  if (!timestamp) return "";
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatConversationTime(timestamp?: number) {
  if (!timestamp) return "";
  const normalized = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(normalized);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return "Вчера";
  }
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(date);
}

function formatTargetKind(kind: MessengerConversationKind) {
  if (kind === "user") return "user_id";
  if (kind === "login") return "login";
  return "chat_id";
}

function normalizePhoneInput(value: string): string {
  const trimmed = value.trim();
  const prefix = trimmed.startsWith("+") ? "+" : "";
  return `${prefix}${trimmed.replace(/\D/g, "")}`;
}

function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function inferUploadKind(path: string): MessengerAttachmentUpload["kind"] {
  const nameParts = fileNameFromPath(path).split(".");
  const extension = nameParts[nameParts.length - 1]?.toLowerCase();
  if (extension && ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(extension)) return "photo";
  if (extension && ["mp4", "mov", "webm", "mkv", "avi"].includes(extension)) return "video";
  return "file";
}

function formatFileSize(size?: number): string {
  if (!size) return "";
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

function formatMessengerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "Ошибка Messenger API.");
  if (message.includes("CONNECTION_REFUSED") || message.includes("upload endpoint")) {
    return "MAX сейчас не принял вложение. Попробуйте отправить файл ещё раз.";
  }
  if (message.length > 180) return `${message.slice(0, 180)}...`;
  return message;
}

function isMissingYandexBotScopeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /missing required scope:\s*botplatform:write/i.test(message);
}

function renderMessageAttachments(message: MessengerMessage) {
  if (!message.attachments?.length) return null;

  return (
    <div className="mt-2 grid gap-2">
      {message.attachments.map((attachment) => {
        if (attachment.kind === "photo" && (attachment.previewUrl || attachment.url)) {
          return (
            <img
              key={attachment.id}
              src={attachment.previewUrl ?? attachment.url}
              alt={attachment.title}
              className="max-h-64 rounded-xl object-cover"
              loading="lazy"
            />
          );
        }
        if (attachment.kind === "audio" && attachment.url) {
          return (
            <div key={attachment.id} className="rounded-xl border border-border-primary/70 bg-bg-primary/50 px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-text-secondary">
                <span className="min-w-0 truncate">{attachment.title}</span>
                {attachment.size ? <span className="shrink-0 opacity-70">{formatFileSize(attachment.size)}</span> : null}
              </div>
              <audio controls src={attachment.url} className="w-full" preload="metadata">
                Ваш браузер не поддерживает воспроизведение аудио.
              </audio>
            </div>
          );
        }
        const Icon = attachment.kind === "video" ? Video : attachment.kind === "photo" ? Image : attachment.kind === "contact" ? Contact : FileIcon;
        return (
          <div key={attachment.id} className="flex items-center gap-2 rounded-xl border border-border-primary/70 bg-bg-primary/50 px-3 py-2 text-xs">
            <Icon size={15} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{attachment.title}</span>
            {attachment.size ? <span className="shrink-0 opacity-70">{formatFileSize(attachment.size)}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function hasUnresolvedMediaAttachment(message: MessengerMessage): boolean {
  return (message.attachments ?? []).some(
    (attachment) => (attachment.kind === "photo" || attachment.kind === "audio") && !attachment.url && !attachment.previewUrl,
  );
}

function conversationFromPendingYandexMessage(message: MessengerMessage): MessengerConversation | null {
  const raw = message.raw;
  if (!raw || typeof raw !== "object") return null;
  const update = raw as {
    chat?: { type?: string; id?: string };
    from?: { login?: string; id?: string; display_name?: string };
  };
  if (update.chat?.type === "private") {
    const id = update.from?.login?.trim() || update.from?.id?.trim();
    if (!id) return null;
    return {
      id,
      providerId: "yandex",
      kind: "login",
      title: update.from?.display_name?.trim() || id,
      subtitle: `login · ${id}`,
      updatedAt: message.timestamp,
    };
  }

  const id = update.chat?.id?.trim();
  if (!id) return null;
  return {
    id,
    providerId: "yandex",
    kind: "chat",
    title: id,
    subtitle: `chat_id · ${id}`,
    updatedAt: message.timestamp,
  };
}

function readCachedArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadCachedMaxConversations(): MessengerConversation[] {
  return readCachedArray<MessengerConversation>(MAX_CONVERSATIONS_CACHE_KEY)
    .filter((conversation) => conversation.providerId === "max" && typeof conversation.id === "string")
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function loadCachedMaxMessages(): MessengerMessage[] {
  return readCachedArray<MessengerMessage>(MAX_MESSAGES_CACHE_KEY)
    .filter((message) => message.providerId === "max" && typeof message.id === "string" && typeof message.conversationId === "string")
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

function saveCachedMaxConversations(conversations: MessengerConversation[]): void {
  try {
    localStorage.setItem(MAX_CONVERSATIONS_CACHE_KEY, JSON.stringify(conversations.slice(0, 250)));
  } catch {
    // Cache persistence is best-effort; the live transport remains the source of truth.
  }
}

function saveCachedMaxMessages(messages: MessengerMessage[]): void {
  try {
    localStorage.setItem(MAX_MESSAGES_CACHE_KEY, JSON.stringify(messages.slice(-1000)));
  } catch {
    // Cache persistence is best-effort; the live transport remains the source of truth.
  }
}

function clearCachedMaxState(): void {
  try {
    localStorage.removeItem(MAX_CONVERSATIONS_CACHE_KEY);
    localStorage.removeItem(MAX_MESSAGES_CACHE_KEY);
  } catch {
    // Nothing to do: explicit logout should not fail because cache removal failed.
  }
}

function ProviderLogo({ provider }: { provider: ProviderView }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary text-text-primary shadow-sm">
      {!failed ? (
        <img src={provider.iconSrc} alt="" className="h-5 w-5 object-contain grayscale" onError={() => setFailed(true)} />
      ) : (
        <MessageCircle size={18} aria-hidden="true" />
      )}
    </span>
  );
}

function mergeConversations(...groups: MessengerConversation[][]): MessengerConversation[] {
  const map = new Map<string, MessengerConversation>();
  for (const conversation of groups.flat()) {
    map.set(`${conversation.providerId}:${conversation.kind}:${conversation.id}`, {
      ...map.get(`${conversation.providerId}:${conversation.kind}:${conversation.id}`),
      ...conversation,
    });
  }
  return [...map.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function mergeMessages(...groups: MessengerMessage[][]): MessengerMessage[] {
  const map = new Map<string, MessengerMessage>();
  for (const message of groups.flat()) {
    map.set(message.id, message);
  }
  return [...map.values()].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

export type MessengerSideStripProps = {
  /**
   * Полная ширина блока мессенджера (список + разделитель + чат).
   * Если задана — правая колонка чата занимает оставшееся место; иначе ширина по сохранённым пикселям колонок.
   */
  asideTotalWidth?: number;
};

export function MessengerSideStrip({ asideTotalWidth }: MessengerSideStripProps = {}) {
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const setMessengersPanelsOpen = useUIStore((s) => s.setMessengersPanelsOpen);
  const [selectedProviderId, setSelectedProviderId] = useState<MessengerProviderId>(DEFAULT_MESSENGER_PROVIDER);
  const [activeProviderIds, setActiveProviderIds] = useState<MessengerProviderId[]>(["max", "yandex"]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<MessengerAttachmentUpload[]>([]);
  const [lightsOut, setLightsOut] = useState(() => isLightsOutActive());
  const [yandexAiAutoReplyEnabled] = useState(() => loadYandexAiAutoReplyEnabled());
  const [busy, setBusy] = useState(false);
  const [, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yandexPollingBlockedReason, setYandexPollingBlockedReason] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [paneWidths, setPaneWidths] = useState<Record<StripPaneId, number>>(() =>
    mergeStripWidths(loadSideStripLayout().paneWidths),
  );
  const paneOrder = DEFAULT_STRIP_ORDER;
  const collapsedPaneIds = COLLAPSED_STRIP_PANES;
  const [maxCredentials, setMaxCredentials] = useState<MessengerCredentials | null>(() => loadMessengerCredentials("max"));
  const [yandexSession, setYandexSession] = useState<YandexMessengerSession | null>(null);
  const [telegramCredentials, setTelegramCredentials] = useState<MessengerCredentials | null>(() => loadMessengerCredentials("telegram"));
  const [tokenInput, setTokenInput] = useState("");
  const [maxPhoneInput, setMaxPhoneInput] = useState("");
  const [maxCodeInput, setMaxCodeInput] = useState("");
  const [maxAuthToken, setMaxAuthToken] = useState<string | null>(null);
  const [maxPasswordChallenge, setMaxPasswordChallenge] = useState<{ trackId?: string; hint?: string } | null>(null);
  const [maxPasswordInput, setMaxPasswordInput] = useState("");
  const [maxRegistrationToken, setMaxRegistrationToken] = useState<string | null>(null);
  const [maxFirstNameInput, setMaxFirstNameInput] = useState("");
  const [maxLastNameInput, setMaxLastNameInput] = useState("");
  const [maxProfileId, setMaxProfileId] = useState<string | null>(null);
  const [selectedConversationKey, setSelectedConversationKey] = useState<string | null>(null);
  const [targetKind, setTargetKind] = useState<MessengerConversationKind>("chat");
  const [targetId, setTargetId] = useState("");
  const [conversations, setConversations] = useState<Record<MessengerProviderId, MessengerConversation[]>>({
    max: loadCachedMaxConversations(),
    yandex: getYandexConversations(loadMessengerTargets("yandex")),
    telegram: [],
  });
  const [messages, setMessages] = useState<Record<MessengerProviderId, MessengerMessage[]>>({
    max: loadCachedMaxMessages(),
    yandex: [],
    telegram: [],
  });
  const autoLoadedHistoryRef = useRef(new Set<string>());
  const loadingHistoryRef = useRef(new Set<string>());

  useEffect(() => {
    const openYandex = () => {
      const next = applyMessengerProviderTab("yandex", ["max", "yandex"]);
      setSelectedProviderId(next.selectedProviderId);
      setSelectedConversationKey(next.selectedConversationKey);
      setActiveProviderIds((current) => applyMessengerProviderTab("yandex", current).activeProviderIds);
      setMessengersPanelsOpen(true);
    };
    window.addEventListener("office360:open-yandex-messenger", openYandex);
    return () => window.removeEventListener("office360:open-yandex-messenger", openYandex);
  }, [setMessengersPanelsOpen]);
  const autoConnectedMaxTokenRef = useRef<string | null>(null);
  const yandexMessagesRef = useRef<MessengerMessage[]>([]);
  const yandexConversationsRef = useRef<MessengerConversation[]>([]);
  const yandexAiAutoReplyEnabledRef = useRef(yandexAiAutoReplyEnabled);
  const yandexAiProcessingRef = useRef(new Set<string>());
  const stripRootRef = useRef<HTMLDivElement | null>(null);
  const conversationPanelRef = useRef<HTMLElement | null>(null);
  const chatPanelRef = useRef<HTMLElement | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);

  const selectedProvider = PROVIDERS.find((provider) => provider.id === selectedProviderId) ?? PROVIDERS[0]!;
  const credentials = useMemo((): MessengerCredentials | null => {
    if (selectedProviderId === "max") return maxCredentials;
    if (selectedProviderId === "telegram") return telegramCredentials;
    if (selectedProviderId === "yandex") {
      if (!yandexSession) return null;
      return {
        providerId: "yandex",
        token: yandexSession.token,
        savedAt: Date.now(),
      };
    }
    return null;
  }, [maxCredentials, selectedProviderId, telegramCredentials, yandexSession]);

  const reloadYandexSession = useCallback(async () => {
    try {
      const next = await resolveYandexMessengerSession(activeAccountId);
      setYandexSession(next);
      setYandexPollingBlockedReason(null);
    } catch (sessionError) {
      console.warn("[yandex-messenger] Не удалось получить сессию:", sessionError);
      setYandexSession(null);
    }
  }, [activeAccountId]);

  useEffect(() => {
    yandexMessagesRef.current = messages.yandex;
  }, [messages.yandex]);

  useEffect(() => {
    yandexConversationsRef.current = conversations.yandex;
  }, [conversations.yandex]);

  useEffect(() => {
    yandexAiAutoReplyEnabledRef.current = yandexAiAutoReplyEnabled;
    saveYandexAiAutoReplyEnabled(yandexAiAutoReplyEnabled);
  }, [yandexAiAutoReplyEnabled]);

  useEffect(() => {
    void reloadYandexSession();
  }, [reloadYandexSession]);

  const sendYandexAiAutoReplies = useCallback(
    async (incomingMessages: MessengerMessage[], incomingConversations: MessengerConversation[]) => {
      if (!yandexAiAutoReplyEnabledRef.current || !yandexSession) return;

      const sourceKey = yandexMessengerSourceKey(yandexSession);
      const repliedIds = loadYandexAiRepliedIds(sourceKey);
      const pendingIds = loadYandexAiPendingIds(sourceKey);
      let pendingMessages = loadYandexAiPendingMessages(sourceKey);
      for (const incomingMessage of incomingMessages) {
        if (incomingMessage.direction !== "incoming" || isRobotMessengerMessage(incomingMessage)) continue;
        if (!repliedIds.has(incomingMessage.id)) {
          pendingIds.add(incomingMessage.id);
          pendingMessages = mergeMessages(pendingMessages, [incomingMessage]);
        }
      }
      saveYandexAiPendingIds(sourceKey, pendingIds);
      saveYandexAiPendingMessages(sourceKey, pendingMessages);

      const conversationsById = new Map(
        mergeConversations(yandexConversationsRef.current, incomingConversations)
          .map((conversation) => [conversation.id, conversation]),
      );
      let history = mergeMessages(pendingMessages, yandexMessagesRef.current, incomingMessages);
      const latestPendingByConversation = new Map<string, MessengerMessage>();
      for (const pendingId of [...pendingIds]) {
        const pendingMessage = history.find((message) => message.id === pendingId);
        if (!pendingMessage || pendingMessage.direction !== "incoming" || isRobotMessengerMessage(pendingMessage)) continue;
        const currentLatest = latestPendingByConversation.get(pendingMessage.conversationId);
        if (!currentLatest || (pendingMessage.timestamp ?? 0) >= (currentLatest.timestamp ?? 0)) {
          latestPendingByConversation.set(pendingMessage.conversationId, pendingMessage);
        }
      }
      const latestPendingIds = new Set([...latestPendingByConversation.values()].map((message) => message.id));

      for (const pendingId of [...pendingIds]) {
        const incomingMessage = history.find((message) => message.id === pendingId);
        if (!incomingMessage) continue;
        if (incomingMessage.direction !== "incoming" || isRobotMessengerMessage(incomingMessage)) {
          pendingIds.delete(pendingId);
          pendingMessages = pendingMessages.filter((message) => message.id !== pendingId);
          saveYandexAiPendingIds(sourceKey, pendingIds);
          saveYandexAiPendingMessages(sourceKey, pendingMessages);
          continue;
        }
        if (!latestPendingIds.has(incomingMessage.id)) {
          pendingIds.delete(incomingMessage.id);
          pendingMessages = pendingMessages.filter((message) => message.id !== incomingMessage.id);
          repliedIds.add(incomingMessage.id);
          saveYandexAiPendingIds(sourceKey, pendingIds);
          saveYandexAiPendingMessages(sourceKey, pendingMessages);
          saveYandexAiRepliedIds(sourceKey, repliedIds);
          continue;
        }
        if (repliedIds.has(incomingMessage.id) || yandexAiProcessingRef.current.has(incomingMessage.id)) continue;

        const conversation = conversationsById.get(incomingMessage.conversationId) ?? conversationFromPendingYandexMessage(incomingMessage);
        if (!conversation) continue;

        yandexAiProcessingRef.current.add(incomingMessage.id);
        try {
          let incomingForReply = incomingMessage;
          if (hasUnresolvedMediaAttachment(incomingForReply)) {
            const [hydratedMessage] = await hydrateYandexMessageAttachments(yandexSession.token, [incomingForReply]);
            if (hydratedMessage) {
              incomingForReply = hydratedMessage;
              history = mergeMessages(history, [hydratedMessage]);
              pendingMessages = mergeMessages(pendingMessages, [hydratedMessage]);
              saveYandexAiPendingMessages(sourceKey, pendingMessages);
              setMessages((current) => ({
                ...current,
                yandex: mergeMessages(current.yandex, [hydratedMessage]),
              }));
            }
          }

          if (hasUnresolvedMediaAttachment(incomingForReply)) {
            throw new Error("Не удалось загрузить изображение/аудио из Яндекс Мессенджера. Сообщение оставлено в очереди автоответа.");
          }

          const toolResult = await executeYandexAssistantTools({
            token: yandexSession.token,
            conversation,
            messages: history,
            incomingMessage: incomingForReply,
          });
          const reply = toolResult.handled
            ? toolResult.replyText
            : await generateYandexMessengerAiReply({
              conversation,
              messages: history,
              incomingMessage: incomingForReply,
            });
          if (!reply) {
            throw new Error("LM Studio вернул пустой ответ. Сообщение оставлено в очереди автоответа.");
          }

          await sendYandexMessage(yandexSession.token, {
            providerId: "yandex",
            targetKind: conversation.kind,
            targetId: conversation.id,
            text: reply,
          });

          const outgoing: MessengerMessage = {
            id: `yandex-ai-${incomingMessage.id}`,
            providerId: "yandex",
            conversationId: conversation.id,
            direction: "outgoing",
            author: "Локальная ИИ",
            text: reply,
            timestamp: Date.now(),
          };

          setMessages((current) => ({
            ...current,
            yandex: mergeMessages(current.yandex, [outgoing]),
          }));
          setConversations((current) => ({
            ...current,
            yandex: mergeConversations([{
              ...conversation,
              lastText: reply,
              updatedAt: Date.now(),
            }], current.yandex),
          }));
          repliedIds.add(incomingMessage.id);
          pendingIds.delete(incomingMessage.id);
          pendingMessages = pendingMessages.filter((message) => message.id !== incomingMessage.id);
          saveYandexAiRepliedIds(sourceKey, repliedIds);
          saveYandexAiPendingIds(sourceKey, pendingIds);
          saveYandexAiPendingMessages(sourceKey, pendingMessages);
        } catch (replyError) {
          console.warn("[yandex-messenger] AI auto reply failed:", replyError);
          setError(`Яндекс ИИ-автоответ: ${formatMessengerError(replyError)}`);
        } finally {
          yandexAiProcessingRef.current.delete(incomingMessage.id);
        }
      }
    },
    [yandexSession],
  );

  const syncYandexMessengerInbox = useCallback(
    async (options: { silent: boolean }) => {
      if (!yandexSession) {
        if (!options.silent) throw new Error("Нет аккаунта Яндекс (OAuth) или токена Bot API. Добавьте почту Яндекс или укажите токен в настройках.");
        return;
      }
      const sourceKey = yandexMessengerSourceKey(yandexSession);
      const offset = loadYandexMessengerUpdateOffset(sourceKey);
      const response = await fetchYandexMessengerUpdates(yandexSession.token, { offset, limit: 500 });
      if (!response.ok) {
        const message = response.description ?? "getUpdates вернул ошибку.";
        if (isMissingYandexBotScopeError(message)) {
          const scopeMessage = "Polling отключён: у токена нет scope botplatform:write.";
          if (yandexPollingBlockedReason !== scopeMessage) {
            setYandexPollingBlockedReason(scopeMessage);
            if (!options.silent) setError(scopeMessage);
          }
          return;
        }
        if (!options.silent) throw new Error(message);
        console.warn("[yandex-messenger] poll:", message);
        return;
      }
      if (yandexPollingBlockedReason) {
        setYandexPollingBlockedReason(null);
      }
      const updates = response.updates ?? [];
      if (!updates.length) {
        void sendYandexAiAutoReplies([], []);
        if (!options.silent) setInfo("Яндекс: новых обновлений нет.");
        return;
      }
      const nextOffset = nextYandexUpdateOffset(updates);
      saveYandexMessengerUpdateOffset(sourceKey, nextOffset);
      const newMessages = await hydrateYandexMessageAttachments(
        yandexSession.token,
        updates.map(messengerMessageFromYandexUpdate),
      );
      const newConversations = updates.map(mergeYandexConversationFromUpdate);
      setMessages((current) => ({
        ...current,
        yandex: mergeMessages(current.yandex, newMessages),
      }));
      setConversations((current) => ({
        ...current,
        yandex: mergeConversations(current.yandex, newConversations, getYandexConversations(loadMessengerTargets("yandex"))),
      }));
      void sendYandexAiAutoReplies(newMessages, newConversations);
      if (!options.silent) setInfo(`Яндекс: получено обновлений: ${updates.length}.`);
    },
    [sendYandexAiAutoReplies, yandexPollingBlockedReason, yandexSession],
  );

  useEffect(() => {
    if (!yandexSession || yandexPollingBlockedReason) return;
    const tick = () => {
      void syncYandexMessengerInbox({ silent: true }).catch((error) => {
        if (isMissingYandexBotScopeError(error)) return;
        console.warn("[yandex-messenger] poll failed:", error);
      });
    };
    tick();
    const intervalId = window.setInterval(tick, 15_000);
    return () => clearInterval(intervalId);
  }, [syncYandexMessengerInbox, yandexPollingBlockedReason, yandexSession]);

  useEffect(() => {
    if (!maxCredentials) {
      autoConnectedMaxTokenRef.current = null;
      return;
    }

    if (autoConnectedMaxTokenRef.current === maxCredentials.token) return;
    autoConnectedMaxTokenRef.current = maxCredentials.token;

    let cancelled = false;
    void Promise.all([
      getMaxMe(maxCredentials.token),
      connectMaxClient(maxCredentials.token),
    ])
      .then(([me, chats]) => {
        if (cancelled) return;
        setMaxProfileId(String(me.user_id));
        setConversations((current) => ({
          ...current,
          max: mergeConversations(chats, current.max),
        }));
      })
      .catch((connectError) => {
        if (cancelled) return;
        autoConnectedMaxTokenRef.current = null;
        console.warn("[max-messenger] auto connect failed:", connectError);
      });

    return () => {
      cancelled = true;
    };
  }, [maxCredentials]);

  const visibleConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return activeProviderIds
      .flatMap((providerId) => conversations[providerId])
      .filter((conversation) => {
        if (!normalizedQuery) return true;
        return `${conversation.title} ${conversation.subtitle} ${conversation.lastText ?? ""}`.toLowerCase().includes(normalizedQuery);
      })
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [activeProviderIds, conversations, query]);

  const selectedConversation = useMemo(() => {
    if (!selectedConversationKey) return visibleConversations[0] ?? null;
    return visibleConversations.find((conversation) => `${conversation.providerId}:${conversation.kind}:${conversation.id}` === selectedConversationKey) ?? visibleConversations[0] ?? null;
  }, [selectedConversationKey, visibleConversations]);

  const conversationMessages = useMemo(() => {
    if (!selectedConversation) return [];
    return messages[selectedConversation.providerId].filter((message) => message.conversationId === selectedConversation.id);
  }, [messages, selectedConversation]);

  useEffect(() => {
    if (!yandexAiAutoReplyEnabled || !selectedConversation || selectedConversation.providerId !== "yandex") return;
    const latestMessage = conversationMessages[conversationMessages.length - 1];
    if (!latestMessage || latestMessage.direction !== "incoming" || isRobotMessengerMessage(latestMessage)) return;
    void sendYandexAiAutoReplies([latestMessage], [selectedConversation]);
  }, [conversationMessages, selectedConversation, sendYandexAiAutoReplies, yandexAiAutoReplyEnabled]);

  const selectedConversationScrollKey = selectedConversation
    ? `${selectedConversation.providerId}:${selectedConversation.kind}:${selectedConversation.id}`
    : "none";
  const lastConversationMessage = conversationMessages[conversationMessages.length - 1];
  const lastConversationMessageKey = lastConversationMessage
    ? `${lastConversationMessage.id}:${lastConversationMessage.timestamp}`
    : "empty";

  const scrollChatToBottom = useCallback(() => {
    const node = chatMessagesRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    scrollChatToBottom();
  }, [conversationMessages.length, lastConversationMessageKey, scrollChatToBottom, selectedConversationScrollKey]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(scrollChatToBottom);
    return () => window.cancelAnimationFrame(frameId);
  }, [conversationMessages.length, lastConversationMessageKey, scrollChatToBottom, selectedConversationScrollKey]);

  useEffect(() => {
    if (selectedConversation?.providerId !== "max" || !maxCredentials || selectedConversation.kind !== "chat") return;

    let cancelled = false;
    const cacheKey = selectedConversation.id;

    const syncSelectedHistory = (showError: boolean) => {
      if (loadingHistoryRef.current.has(cacheKey)) return;
      loadingHistoryRef.current.add(cacheKey);

      void getMaxMessages(maxCredentials.token, selectedConversation.id)
        .then((history) => {
          if (cancelled) return;
          if (!history.length) {
            autoLoadedHistoryRef.current.delete(cacheKey);
            return;
          }

          const latest = history[history.length - 1];
          autoLoadedHistoryRef.current.add(cacheKey);
          setMessages((current) => ({
            ...current,
            max: mergeMessages(current.max, history),
          }));
          if (latest) {
            setConversations((current) => ({
              ...current,
              max: mergeConversations([{
                ...selectedConversation,
                lastText: latest.text,
                updatedAt: latest.timestamp ?? Date.now(),
              }], current.max),
            }));
          }
        })
        .catch((historyError) => {
          if (cancelled) return;
          autoLoadedHistoryRef.current.delete(cacheKey);
          if (showError) {
            setError(historyError instanceof Error ? historyError.message : String(historyError || "Не удалось загрузить историю MAX."));
          } else {
            console.warn("[max-messenger] history sync failed:", historyError);
          }
        })
        .finally(() => {
          loadingHistoryRef.current.delete(cacheKey);
        });
    };

    syncSelectedHistory(conversationMessages.length === 0);
    const intervalId = window.setInterval(() => syncSelectedHistory(false), 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [conversationMessages.length, maxCredentials, selectedConversation]);

  useEffect(() => {
    saveCachedMaxConversations(conversations.max);
  }, [conversations.max]);

  useEffect(() => {
    saveCachedMaxMessages(messages.max);
  }, [messages.max]);

  useEffect(() => {
    if (asideTotalWidth !== undefined) {
      const inner = asideTotalWidth - INNER_STRIP_DIVIDER_PX;
      setPaneWidths((w) => {
        const sum = w.messengerList + w.messengerChat;
        if (sum <= inner) return w;
        let L = w.messengerList;
        let R = w.messengerChat;
        const ratio = inner / sum;
        L = Math.round(L * ratio);
        R = inner - L;
        L = clamp(L, STRIP_PANE_LIMITS.messengerList.min, STRIP_PANE_LIMITS.messengerList.max);
        R = inner - L;
        R = clamp(R, STRIP_PANE_LIMITS.messengerChat.min, STRIP_PANE_LIMITS.messengerChat.max);
        L = inner - R;
        L = clamp(L, STRIP_PANE_LIMITS.messengerList.min, STRIP_PANE_LIMITS.messengerList.max);
        return { messengerList: L, messengerChat: R };
      });
    }
  }, [asideTotalWidth]);

  useEffect(() => {
    if (!stripRootRef.current) return;
    if (asideTotalWidth !== undefined) {
      stripRootRef.current.style.width = `${asideTotalWidth}px`;
    } else {
      stripRootRef.current.style.width = "";
    }
  }, [asideTotalWidth]);

  useEffect(() => {
    if (conversationPanelRef.current) {
      conversationPanelRef.current.style.width = "360px";
    }
    if (chatPanelRef.current) {
      if (asideTotalWidth !== undefined) {
        chatPanelRef.current.style.width = "";
      } else {
        chatPanelRef.current.style.width = `${paneWidths.messengerChat}px`;
      }
    }
  }, [paneWidths, asideTotalWidth]);

  useEffect(() => {
    const panes: Record<StripPaneId, HTMLElement | null> = {
      messengerList: conversationPanelRef.current,
      messengerChat: chatPanelRef.current,
    };

    for (const paneId of ALL_STRIP_PANE_IDS) {
      const pane = panes[paneId];
      if (!pane) continue;
      pane.style.order = String(paneOrder.indexOf(paneId) * 2);
      pane.style.display = collapsedPaneIds.includes(paneId) ? "none" : "";
    }

  }, [collapsedPaneIds, paneOrder]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const payload: PersistedMessengerLayout = {
          paneWidths,
          paneOrder,
          collapsedPaneIds,
        };
        localStorage.setItem(STRIP_LAYOUT_KEY, JSON.stringify(payload));
      } catch {
        // best-effort persistence
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [paneWidths, collapsedPaneIds, paneOrder]);

  useEffect(() => {
    if (selectedConversation) {
      setTargetKind(selectedConversation.kind);
      setTargetId(selectedConversation.id);
    } else {
      setTargetKind(selectedProviderId === "yandex" ? "login" : "chat");
      setTargetId("");
    }
  }, [selectedConversation, selectedProviderId]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    void listen("max-client-event", (event) => {
      const normalized = normalizeMaxClientEvent(event.payload, maxProfileId);
      const { conversation, message } = normalized;
      if (!conversation || !message) return;
      setConversations((current) => ({
        ...current,
        max: mergeConversations([conversation], current.max),
      }));
      setMessages((current) => ({
        ...current,
        max: mergeMessages(current.max, [message]),
      }));
    }).then((cleanup) => {
      if (active) {
        unlisten = cleanup;
      } else {
        cleanup();
      }
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [maxProfileId]);

  const toggleLightsOut = useCallback(() => {
    const next = !lightsOut;
    try {
      if (next) {
        localStorage.setItem(LIGHTS_OUT_UNTIL_KEY, String(endOfDayTimestamp()));
      } else {
        localStorage.removeItem(LIGHTS_OUT_UNTIL_KEY);
      }
    } catch {
      // Theme override is best-effort and should never block the messenger UI.
    }
    setLightsOut(next);
    window.dispatchEvent(new Event(LIGHTS_OUT_CHANGED_EVENT));
  }, [lightsOut]);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (actionError) {
      setError(formatMessengerError(actionError));
    } finally {
      setBusy(false);
    }
  }, []);

  const pickAttachments = useCallback(() => {
    void runAction(async () => {
      const selected = await open({
        multiple: true,
        title: "Выберите файлы для MAX",
        filters: [{
          name: "Файлы, изображения и видео",
          extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "mp4", "mov", "webm", "mkv", "avi", "pdf", "doc", "docx", "xls", "xlsx", "zip", "txt"],
        }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      setPendingAttachments((current) => [
        ...current,
        ...paths.map((path) => ({
          path,
          kind: inferUploadKind(path),
          name: fileNameFromPath(path),
        })),
      ]);
      setInfo(`Добавлено вложений: ${paths.length}.`);
    });
  }, [runAction]);

  const removePendingAttachment = useCallback((path: string) => {
    setPendingAttachments((current) => current.filter((attachment) => attachment.path !== path));
  }, []);

  const selectProvider = useCallback((providerId: MessengerProviderId) => {
    setActiveProviderIds((current) => {
      const next = applyMessengerProviderTab(providerId, current);
      setSelectedProviderId(next.selectedProviderId);
      setSelectedConversationKey(next.selectedConversationKey);
      return next.activeProviderIds;
    });
    setError(null);
    setInfo(null);
    setQuery("");
  }, []);

  const saveToken = useCallback(() => {
    const token = tokenInput.trim();
    if (!token) {
      setError("Введите token выбранного провайдера.");
      return;
    }
    const saved = saveMessengerCredentials(selectedProviderId, token);
    if (selectedProviderId === "max") setMaxCredentials(saved);
    if (selectedProviderId === "telegram") setTelegramCredentials(saved);
    if (selectedProviderId === "yandex") void reloadYandexSession();
    setTokenInput("");
    setError(null);
    setInfo(`${selectedProvider.name}: token сохранён локально.`);
  }, [reloadYandexSession, selectedProvider.name, selectedProviderId, tokenInput]);

  const clearToken = useCallback(() => {
    clearMessengerCredentials(selectedProviderId);
    if (selectedProviderId === "max") {
      setMaxCredentials(null);
      setMaxProfileId(null);
      setMaxAuthToken(null);
      setMaxPasswordChallenge(null);
      setMaxPasswordInput("");
      setMaxRegistrationToken(null);
      clearCachedMaxState();
      void disconnectMaxClient();
    }
    if (selectedProviderId === "yandex") void reloadYandexSession();
    if (selectedProviderId === "telegram") setTelegramCredentials(null);
    setMessages((current) => ({ ...current, [selectedProviderId]: [] }));
    setConversations((current) => ({ ...current, [selectedProviderId]: [] }));
    setSelectedConversationKey(null);
    setInfo(`${selectedProvider.name}: token удалён.`);
    setError(null);
  }, [reloadYandexSession, selectedProvider.name, selectedProviderId]);

  const startMaxLogin = useCallback(() => {
    void runAction(async () => {
      const phone = normalizePhoneInput(maxPhoneInput);
      if (!/^\+?\d{10,15}$/.test(phone)) {
        throw new Error("Введите номер телефона MAX в международном формате: только цифры и необязательный + в начале.");
      }
      setMaxPhoneInput(phone);
      const response = await startMaxAuth(phone);
      const authToken = response.payload?.token;
      if (!authToken) throw new Error(`MAX не вернул временный token авторизации: ${JSON.stringify(response)}`);
      setMaxAuthToken(authToken);
      setMaxCodeInput("");
      setInfo("Код отправлен. Введите SMS-код подтверждения.");
    });
  }, [maxPhoneInput, runAction]);

  const submitMaxCode = useCallback(() => {
    void runAction(async () => {
      const code = maxCodeInput.trim();
      if (!maxAuthToken) throw new Error("Сначала запросите код MAX.");
      if (!code) throw new Error("Введите код подтверждения MAX.");
      const response = await checkMaxAuthCode(maxAuthToken, code);
      if (response.needsPassword) {
        setMaxPasswordChallenge(response.passwordChallenge ?? {});
        setMaxPasswordInput("");
        setInfo("MAX подтвердил SMS. Введите пароль двухфакторной защиты.");
        return;
      }
      if (response.needsRegistration && response.registrationToken) {
        setMaxRegistrationToken(response.registrationToken);
        setInfo("MAX подтвердил SMS. Заполните имя, чтобы завершить регистрацию аккаунта.");
        return;
      }
      if (!response.token) {
        throw new Error(`MAX не вернул token сессии: ${JSON.stringify(response.auth ?? response)}`);
      }
      const saved = saveMessengerCredentials("max", response.token);
      setMaxCredentials(saved);
      const me = await getMaxMe(saved.token);
      setMaxProfileId(String(me.user_id));
      const chats = await connectMaxClient(saved.token);
      setConversations((current) => ({ ...current, max: mergeConversations(chats, current.max) }));
      setMaxAuthToken(null);
      setMaxCodeInput("");
      setInfo(`MAX подключён: ${me.name ?? me.first_name ?? me.user_id}.`);
    });
  }, [maxAuthToken, maxCodeInput, runAction]);

  const submitMaxPassword = useCallback(() => {
    void runAction(async () => {
      const trackId = maxPasswordChallenge?.trackId;
      const password = maxPasswordInput.trim();
      if (!trackId) throw new Error("MAX не вернул trackId для проверки пароля.");
      if (!password) throw new Error("Введите пароль двухфакторной защиты MAX.");
      const response = await checkMaxPassword(trackId, password);
      if (!response.token) throw new Error("MAX не вернул token после проверки пароля.");
      const saved = saveMessengerCredentials("max", response.token);
      setMaxCredentials(saved);
      const me = await getMaxMe(saved.token);
      setMaxProfileId(String(me.user_id));
      const chats = await connectMaxClient(saved.token);
      setConversations((current) => ({ ...current, max: mergeConversations(chats, current.max) }));
      setMaxPasswordChallenge(null);
      setMaxPasswordInput("");
      setMaxAuthToken(null);
      setMaxCodeInput("");
      setInfo(`MAX подключён: ${me.name ?? me.first_name ?? me.user_id}.`);
    });
  }, [maxPasswordChallenge?.trackId, maxPasswordInput, runAction]);

  const submitMaxRegistration = useCallback(() => {
    void runAction(async () => {
      if (!maxRegistrationToken) throw new Error("Сначала подтвердите SMS-код MAX.");
      const firstName = maxFirstNameInput.trim();
      if (!firstName) throw new Error("Введите имя для регистрации MAX.");
      const response = await completeMaxRegistration(maxRegistrationToken, firstName, maxLastNameInput.trim());
      if (!response.token) throw new Error("MAX не вернул token после регистрации.");
      const saved = saveMessengerCredentials("max", response.token);
      setMaxCredentials(saved);
      const me = await getMaxMe(saved.token);
      setMaxProfileId(String(me.user_id));
      const chats = await connectMaxClient(saved.token);
      setConversations((current) => ({ ...current, max: mergeConversations(chats, current.max) }));
      setMaxRegistrationToken(null);
      setMaxAuthToken(null);
      setMaxCodeInput("");
      setInfo(`MAX зарегистрирован и подключён: ${me.name ?? me.first_name ?? me.user_id}.`);
    });
  }, [maxFirstNameInput, maxLastNameInput, maxRegistrationToken, runAction]);

  const verifyToken = useCallback(() => {
    void runAction(async () => {
      if (!credentials) throw new Error("Подключите аккаунт или сохраните token.");
      if (selectedProviderId === "max") {
        const me = await getMaxMe(credentials.token);
        setMaxProfileId(String(me.user_id));
        setInfo(`MAX token рабочий: ${me.username ?? me.first_name ?? me.name ?? me.user_id}.`);
        return;
      }

      if (selectedProviderId === "yandex") {
        if (!yandexSession) throw new Error("Нет OAuth-сессии Яндекс Почты или токена бота.");
        if (targetKind === "login" && targetId.trim()) {
          const link = await getYandexUserLink(credentials.token, targetId.trim());
          if (!link.ok) throw new Error(link.description ?? "Яндекс не подтвердил token/login.");
          setInfo(`Яндекс: пользователь найден: ${link.id ?? targetId.trim()}.`);
          return;
        }
        const sourceKey = yandexMessengerSourceKey(yandexSession);
        const offset = loadYandexMessengerUpdateOffset(sourceKey);
        const head = await fetchYandexMessengerUpdates(credentials.token, { offset, limit: 1 });
        if (!head.ok) throw new Error(head.description ?? "Яндекс Messenger отклонил запрос.");
        setInfo("Яндекс Messenger API отвечает (getUpdates).");
        return;
      }

      throw new Error("Проверка token для этого провайдера не реализована.");
    });
  }, [credentials, runAction, selectedProviderId, targetId, targetKind, yandexSession]);

  const refreshConversations = useCallback(() => {
    void runAction(async () => {
      if (!credentials) throw new Error("Подключите аккаунт или сохраните token.");
      if (selectedProviderId === "max") {
        const me = await getMaxMe(credentials.token);
        setMaxProfileId(String(me.user_id));
        const [chats, liveChats] = await Promise.all([
          getMaxConversations(credentials.token),
          connectMaxClient(credentials.token),
        ]);
        setConversations((current) => ({
          ...current,
          max: mergeConversations(chats, liveChats, current.max),
        }));
        setInfo(`MAX подключён: чатов ${mergeConversations(chats, liveChats).length}.`);
        return;
      }

      if (selectedProviderId === "yandex") {
        await syncYandexMessengerInbox({ silent: false });
        return;
      }

      throw new Error("Обновление диалогов для этого провайдера не реализовано.");
    });
  }, [credentials, runAction, selectedProviderId, syncYandexMessengerInbox]);

  const selectConversation = useCallback((conversation: MessengerConversation) => {
    setSelectedConversationKey(`${conversation.providerId}:${conversation.kind}:${conversation.id}`);
    setSelectedProviderId(conversation.providerId);
    setTargetKind(conversation.kind);
    setTargetId(conversation.id);
  }, []);

  const sendMessage = useCallback(() => {
    void runAction(async () => {
      if (!credentials) throw new Error("Подключите аккаунт или сохраните token.");
      const text = draft.trim();
      const target = targetId.trim();
      const attachmentsToSend = pendingAttachments;
      if (!target) throw new Error(`Введите ${selectedProvider.targetHint}.`);
      if (!text && attachmentsToSend.length === 0) throw new Error("Введите текст сообщения или добавьте вложение.");

      setPendingAttachments([]);

      if (selectedProviderId === "max") {
        try {
          await sendMaxMessage(credentials.token, { providerId: "max", targetKind, targetId: target, text, attachments: attachmentsToSend });
        } catch (sendError) {
          setPendingAttachments(attachmentsToSend);
          throw sendError;
        }
      } else if (selectedProviderId === "yandex") {
        if (attachmentsToSend.length > 0) {
          setPendingAttachments(attachmentsToSend);
          throw new Error("Вложения сейчас подключены для MAX client protocol.");
        }
        await sendYandexMessage(credentials.token, { providerId: "yandex", targetKind, targetId: target, text });
        const targets = saveMessengerTarget({
          id: target,
          providerId: "yandex",
          kind: targetKind === "chat" ? "chat" : "login",
          title: target,
          subtitle: formatTargetKind(targetKind),
        });
        setConversations((current) => ({ ...current, yandex: getYandexConversations(targets) }));
      } else {
        setPendingAttachments(attachmentsToSend);
        throw new Error("Отправка для этого мессенджера пока не подключена.");
      }

      const outgoing: MessengerMessage = {
        id: `${selectedProviderId}-${target}-${Date.now()}`,
        providerId: selectedProviderId,
        conversationId: target,
        direction: "outgoing",
        author: "Вы",
        text: text || `Вложения: ${attachmentsToSend.length}`,
        attachments: attachmentsToSend.map((attachment) => ({
          id: `local-${attachment.path}`,
          kind: attachment.kind,
          title: attachment.name ?? fileNameFromPath(attachment.path),
          raw: attachment,
        })),
        timestamp: Date.now(),
      };

      setMessages((current) => ({ ...current, [selectedProviderId]: [...current[selectedProviderId], outgoing] }));
      setConversations((current) => ({
        ...current,
        [selectedProviderId]: mergeConversations(current[selectedProviderId], [{
          id: target,
          providerId: selectedProviderId,
          kind: targetKind,
          title: selectedConversation?.title ?? target,
          subtitle: selectedConversation?.subtitle ?? formatTargetKind(targetKind),
          lastText: text,
          updatedAt: Date.now(),
        }]),
      }));
      setSelectedConversationKey(`${selectedProviderId}:${targetKind}:${target}`);
      setDraft("");
    });
  }, [credentials, draft, pendingAttachments, runAction, selectedConversation?.subtitle, selectedConversation?.title, selectedProvider.targetHint, selectedProviderId, targetId, targetKind]);

  const chatColumnClass =
    asideTotalWidth !== undefined
      ? `messenger-slide-panel messenger-slide-panel-delay flex min-h-0 min-w-0 flex-1 flex-col bg-bg-primary/75 ${COLUMN_BORDER_CLASS}`
      : `messenger-slide-panel messenger-slide-panel-delay flex min-h-0 min-w-[320px] max-w-[520px] flex-none flex-col bg-bg-primary/75 ${COLUMN_BORDER_CLASS}`;

  if (selectedProviderId === "yandex") {
    return (
      <div ref={stripRootRef} className="relative flex h-full min-h-0 min-w-[640px] flex-1 flex-col overflow-hidden bg-bg-primary">
        <header className="flex items-center justify-between gap-3 border-b border-border-primary bg-bg-secondary/85 px-4 py-2">
          <div className="flex items-center gap-2">
            <ProviderLogo provider={selectedProvider} />
            <div>
              <div className="text-sm font-semibold text-text-primary">Яндекс Мессенджер</div>
              <div className="text-[0.6875rem] text-text-tertiary">Пользовательские чаты активного Яндекс ID</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {MESSENGER_PROVIDER_TABS.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => selectProvider(provider.id)}
                className={`rounded-lg px-2 py-1 text-xs ${
                  provider.id === selectedProviderId ? "bg-bg-tertiary text-text-primary" : "text-text-tertiary hover:bg-bg-hover"
                }`}
              >
                {provider.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowSettings((value) => !value)}
              className={`rounded-lg p-2 hover:bg-bg-hover ${showSettings ? "bg-bg-tertiary text-text-primary" : "text-text-tertiary"}`}
              title="Автоматизация через Bot API"
            >
              <Settings size={17} />
            </button>
            <button
              type="button"
              onClick={() => setMessengersPanelsOpen(false)}
              className="rounded-lg p-2 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
              title="Скрыть мессенджеры"
            >
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="relative min-h-0 flex-1">
          <YandexMessengerWidget accountId={activeAccountId} />
          {showSettings ? (
            <div className="absolute right-3 top-3 z-20 w-80 rounded-2xl border border-border-primary bg-bg-primary p-4 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-text-primary">Автоматизация Bot API</div>
                  <div className="mt-1 text-xs text-text-tertiary">
                    Только токен организационного бота. Пользовательский OAuth сюда не передаётся.
                  </div>
                </div>
                <button type="button" onClick={() => setShowSettings(false)} className="rounded p-1 text-text-tertiary hover:bg-bg-hover">
                  <X size={15} />
                </button>
              </div>
              <input
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="Токен организационного бота"
                className="mt-3 w-full rounded-xl border border-border-primary bg-bg-secondary px-3 py-2 text-sm outline-none focus:border-accent"
                type="password"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" onClick={saveToken} className="rounded-xl bg-bg-tertiary px-3 py-2 text-xs font-medium hover:bg-bg-hover">
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={verifyToken}
                  disabled={busy || !credentials}
                  className="rounded-xl border border-border-primary px-3 py-2 text-xs disabled:opacity-50"
                >
                  Проверить
                </button>
              </div>
              {error ? <div className="mt-2 text-xs text-danger">{error}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={stripRootRef}
      className="relative flex h-full min-h-0 shrink-0 overflow-hidden bg-bg-primary/45"
    >
      <section
        ref={conversationPanelRef}
        className="messenger-slide-panel w-[360px] min-w-[360px] max-w-[360px] shrink-0 overflow-hidden bg-bg-secondary/85 shadow-none"
      >
        <div className="flex h-full flex-col">
          <header className="border-b border-border-primary px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-text-tertiary">Мессенджеры</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedConversationKey(null);
                    setTargetKind("chat");
                    setTargetId("");
                    setDraft("");
                  }}
                  className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
                  title="Новый диалог"
                  aria-label="Новый диалог"
                >
                  <Plus size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowContacts((value) => !value)}
                  className={`rounded-lg p-2 transition-colors ${
                    showContacts ? "bg-bg-tertiary text-text-primary" : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                  }`}
                  title="Записная книжка"
                  aria-label="Записная книжка"
                >
                  <Contact size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowSettings((value) => !value)}
                  className={`rounded-lg p-2 transition-colors ${
                    showSettings ? "bg-bg-tertiary text-text-primary" : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                  }`}
                  title="Настройки MAX"
                  aria-label="Настройки MAX"
                >
                  <Settings size={18} />
                </button>
                <button
                  type="button"
                  onClick={toggleLightsOut}
                  className={`rounded-lg p-2 transition-colors ${
                    lightsOut ? "bg-bg-tertiary text-text-primary" : "text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                  }`}
                  title={lightsOut ? "Вернуть свет" : "Выключить свет до конца дня"}
                  aria-label={lightsOut ? "Вернуть свет" : "Выключить свет до конца дня"}
                >
                  <Moon size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setMessengersPanelsOpen(false)}
                  className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
                  title="Скрыть мессенджеры"
                  aria-label="Скрыть мессенджеры"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {!showSettings ? (
              <div className="mt-5 grid grid-cols-3 gap-1.5">
                {MESSENGER_PROVIDER_TABS.map((provider) => {
                  const isActive = selectedProviderId === provider.id;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => selectProvider(provider.id)}
                      className={`rounded-lg border px-2 py-1 text-[0.6875rem] font-medium transition-colors ${
                        isActive
                          ? "border-border-primary bg-bg-tertiary text-text-primary"
                          : "border-border-primary bg-bg-primary/70 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                      }`}
                    >
                      {provider.label}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {showSettings ? <div className="mt-3 grid grid-cols-3 gap-1.5">
              {MESSENGER_PROVIDER_TABS.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => selectProvider(provider.id)}
                  className={`rounded-lg border px-2 py-1 text-[0.6875rem] font-medium transition-all ${
                    selectedProviderId === provider.id
                      ? "border-border-primary bg-bg-tertiary text-text-primary"
                      : "border-border-primary bg-bg-primary/70 text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {provider.label}
                </button>
              ))}
            </div> : null}

            {showSettings ? <div className="mt-4 max-h-[58vh] overflow-y-auto rounded-2xl border border-border-primary bg-bg-primary/70 p-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-text-primary">{selectedProvider.subtitle}</p>
                  <p className="mt-1 text-xs text-text-tertiary">
                    {credentials
                      ? `Token: ${maskMessengerToken(credentials.token)}`
                      : selectedProvider.tokenLabel}
                  </p>
                </div>
                {credentials ? (
                  <button
                    type="button"
                    onClick={clearToken}
                    className="rounded-lg p-2 text-text-tertiary hover:bg-bg-hover hover:text-danger"
                    title="Удалить token"
                    aria-label="Удалить token"
                  >
                    <LogOut size={16} />
                  </button>
                ) : null}
              </div>

              <div className="mt-3 space-y-2">
                {selectedProviderId === "max" ? (
                  <div className="rounded-xl border border-border-primary bg-bg-secondary/70 p-2">
                    <div className="grid gap-2">
                      <input
                        value={maxPhoneInput}
                        onChange={(event) => setMaxPhoneInput(normalizePhoneInput(event.target.value))}
                        placeholder="+79991234567"
                        className="w-full rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                        type="tel"
                        aria-label="Номер телефона MAX"
                      />
                      <div className="grid grid-cols-1 gap-2">
                        <input
                          value={maxCodeInput}
                          onChange={(event) => setMaxCodeInput(event.target.value)}
                          placeholder="SMS-код"
                          className="min-w-0 rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                          inputMode="numeric"
                          aria-label="Код подтверждения MAX"
                        />
                        <button
                          type="button"
                          onClick={submitMaxCode}
                          disabled={busy || !maxAuthToken || !maxCodeInput.trim()}
                          className="w-full rounded-lg border border-border-primary px-3 py-2 text-xs text-text-secondary hover:border-border-primary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                        >
                          Войти
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={startMaxLogin}
                        disabled={busy || !maxPhoneInput.trim()}
                        className="rounded-lg border border-border-primary bg-bg-tertiary px-3 py-2 text-xs font-medium text-text-primary hover:bg-bg-hover disabled:opacity-50"
                      >
                        Получить код MAX
                      </button>
                      {maxRegistrationToken ? (
                        <div className="grid gap-2 rounded-lg border border-warning/25 bg-warning/10 p-2">
                          <div className="text-xs text-text-secondary">
                            Аккаунт нужно зарегистрировать: SMS уже подтверждена.
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            <input
                              value={maxFirstNameInput}
                              onChange={(event) => setMaxFirstNameInput(event.target.value)}
                              placeholder="Имя"
                              className="min-w-0 rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                              aria-label="Имя MAX"
                            />
                            <input
                              value={maxLastNameInput}
                              onChange={(event) => setMaxLastNameInput(event.target.value)}
                              placeholder="Фамилия"
                              className="min-w-0 rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                              aria-label="Фамилия MAX"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={submitMaxRegistration}
                            disabled={busy || !maxFirstNameInput.trim()}
                            className="rounded-lg border border-border-primary bg-bg-tertiary px-3 py-2 text-xs font-medium text-text-primary hover:bg-bg-hover disabled:opacity-50"
                          >
                            Завершить регистрацию
                          </button>
                        </div>
                      ) : null}
                      {maxPasswordChallenge ? (
                        <div className="grid gap-2 rounded-lg border border-warning/25 bg-warning/10 p-2">
                          <div className="text-xs text-text-secondary">
                            Введите пароль двухфакторной защиты
                            {maxPasswordChallenge.hint ? `, подсказка: ${maxPasswordChallenge.hint}` : ""}.
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            <input
                              value={maxPasswordInput}
                              onChange={(event) => setMaxPasswordInput(event.target.value)}
                              placeholder="Пароль"
                              className="min-w-0 rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                              type="password"
                              aria-label="Пароль двухфакторной защиты MAX"
                            />
                            <button
                              type="button"
                              onClick={submitMaxPassword}
                              disabled={busy || !maxPasswordInput.trim()}
                              className="rounded-lg border border-border-primary bg-bg-tertiary px-3 py-2 text-xs font-medium text-text-primary hover:bg-bg-hover disabled:opacity-50"
                            >
                              Подтвердить
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {selectedProviderId === "telegram" ? (
                  <div className="rounded-xl border border-border-primary/70 bg-bg-secondary/60 p-3 text-xs text-text-tertiary">
                    Telegram пока отображается в режиме preview. Подключение можно будет включить позже без перегруженной формы.
                  </div>
                ) : (
                  <>
                    <input
                      value={tokenInput}
                      onChange={(event) => setTokenInput(event.target.value)}
                      placeholder={selectedProviderId === "max" ? "Или вставьте готовый __oneme_auth token" : selectedProvider.tokenLabel}
                      className="w-full rounded-xl border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                      type="password"
                      aria-label={selectedProvider.tokenLabel}
                    />
                    <div className="grid grid-cols-1 gap-2">
                      <button type="button" onClick={saveToken} className="w-full rounded-xl border border-border-primary bg-bg-tertiary px-3 py-2 text-xs font-medium text-text-primary hover:bg-bg-hover">
                        Сохранить
                      </button>
                      <button
                        type="button"
                        onClick={verifyToken}
                        disabled={busy || !credentials}
                        className="w-full rounded-xl border border-border-primary px-3 py-2 text-xs text-text-secondary hover:border-border-primary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                      >
                        Проверить
                      </button>
                      <button
                        type="button"
                        onClick={refreshConversations}
                        disabled={busy || !credentials}
                        title="Обновить диалоги"
                        aria-label="Обновить диалоги"
                        className="w-full rounded-xl border border-border-primary px-3 py-2 text-xs text-text-secondary hover:border-border-primary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
                          Обновить
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              {error ? (
                <div className="mt-3 flex gap-2 rounded-xl border border-danger/20 bg-danger/10 p-2 text-xs text-danger">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}
            </div> : null}

            {error && !showSettings ? (
              <div className="mt-3 flex gap-2 rounded-xl border border-danger/20 bg-danger/10 p-2 text-xs text-danger">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <label className="mt-4 flex items-center gap-2 rounded-xl border border-border-primary bg-bg-primary/70 px-3 py-2 text-sm focus-within:border-accent">
              <Search size={16} className="text-text-tertiary" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск диалога"
                className="min-w-0 flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-tertiary"
                aria-label="Поиск по мессенджерам"
              />
            </label>
          </header>

          <div className="flex-1 overflow-y-auto">
            {visibleConversations.length ? visibleConversations.map((conversation) => {
              const isActive = selectedConversation?.providerId === conversation.providerId && selectedConversation.id === conversation.id && selectedConversation.kind === conversation.kind;
              const ProviderIcon = conversation.kind === "chat" ? Users : conversation.kind === "login" ? Hash : Bot;
              return (
                <button
                  key={`${conversation.providerId}:${conversation.kind}:${conversation.id}`}
                  type="button"
                  onClick={() => selectConversation(conversation)}
                  title={`${formatTargetKind(conversation.kind)} · ${conversation.id}`}
                  className={`messenger-chat-row focus-ring group pressable t-fast flex w-full gap-3 border-b border-hairline px-4 py-3 text-left ${
                    isActive ? "bg-bg-selected text-text-primary" : "text-text-primary hover:bg-bg-hover"
                  }`}
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                    isActive
                      ? "bg-accent text-white"
                      : "bg-bg-tertiary text-text-secondary group-hover:bg-accent/10 group-hover:text-accent"
                  }`}
                  >
                    <ProviderIcon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-text-primary">{conversation.title}</span>
                      <span className="shrink-0 whitespace-nowrap text-xs text-text-tertiary">
                        {formatConversationTime(conversation.updatedAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-text-secondary">{conversation.lastText ?? conversation.subtitle}</span>
                    <span className="mt-0.5 flex items-center justify-end text-[0.625rem] text-text-tertiary">
                      <span className="shrink-0 rounded-full bg-bg-tertiary px-1.5 normal-case tracking-normal">
                        {PROVIDERS.find((provider) => provider.id === conversation.providerId)?.name ?? conversation.providerId}
                      </span>
                    </span>
                  </span>
                </button>
              );
            }) : (
              <div className="rounded-2xl border border-dashed border-border-primary p-4 text-sm text-text-tertiary">
                {selectedProviderId === "max"
                  ? "Войдите по номеру телефона или вставьте текущий MAX session token, затем нажмите «Обновить»."
                  : "Укажите идентификатор чата и отправьте сообщение."}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="w-px shrink-0 bg-border-primary" aria-hidden />

      <section ref={chatPanelRef} className={chatColumnClass}>
        <header className="flex items-center justify-between gap-3 border-b border-border-primary bg-bg-secondary/70 px-4 py-2 shadow-none">
          <div className="flex min-w-0 items-center gap-2.5">
            <ProviderLogo provider={selectedProvider} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="truncate text-sm font-semibold text-text-primary">
                  {selectedConversation?.title ?? selectedProvider.name}
                </h2>
                <span className="rounded-full bg-bg-tertiary px-1.5 py-0.5 text-[0.625rem] text-text-tertiary">
                  {selectedProvider.name}
                </span>
              </div>
              <p className="truncate text-[0.6875rem] text-text-tertiary">{selectedProvider.subtitle}</p>
            </div>
          </div>
        </header>

        <div ref={chatMessagesRef} className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mx-auto flex max-w-full flex-col gap-2">
            {conversationMessages.length ? conversationMessages.map((message) => (
              <div key={message.id} className={`flex ${message.direction === "outgoing" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[70%] rounded-xl px-3 py-2 text-xs shadow-sm ${
                    message.direction === "outgoing"
                      ? "rounded-br border border-border-primary bg-bg-tertiary text-text-primary"
                      : "rounded-bl border border-border-primary bg-bg-primary text-text-primary"
                  }`}
                >
                  {message.text ? <p className="leading-relaxed">{message.text}</p> : null}
                  {renderMessageAttachments(message)}
                  <div className="mt-0.5 flex items-center justify-end gap-1 text-[0.625rem] text-text-tertiary">
                    {formatMessageTime(message.timestamp)}
                    {message.direction === "outgoing" ? <Check size={10} /> : null}
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-border-primary p-4 text-center text-xs text-text-tertiary">
                Выберите диалог, загрузите историю MAX или отправьте первое сообщение.
              </div>
            )}
          </div>
        </div>

        <footer className="border-t border-border-primary bg-bg-secondary/80 px-4 py-2 shadow-none">
          <div className="mx-auto max-w-full">
            {pendingAttachments.length ? (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {pendingAttachments.map((attachment) => {
                  const Icon = attachment.kind === "photo" ? Image : attachment.kind === "video" ? Video : FileIcon;
                  return (
                    <span key={attachment.path} className="flex max-w-full items-center gap-1.5 rounded-full border border-border-primary bg-bg-primary px-2 py-0.5 text-[0.6875rem] text-text-secondary">
                      <Icon size={12} />
                      <span className="max-w-40 truncate">{attachment.name ?? fileNameFromPath(attachment.path)}</span>
                      <button
                        type="button"
                        onClick={() => removePendingAttachment(attachment.path)}
                        className="text-text-tertiary hover:text-danger"
                        aria-label={`Убрать вложение ${attachment.name ?? fileNameFromPath(attachment.path)}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : null}
            <div className="flex items-end gap-1.5">
              <button
                type="button"
                onClick={pickAttachments}
                disabled={busy || !credentials || selectedProviderId !== "max"}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-primary text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Добавить файл, изображение или видео"
              >
                <Paperclip size={16} />
              </button>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={credentials ? "Сообщение" : "Сначала подключите аккаунт"}
              className="max-h-32 min-h-16 min-w-0 flex-1 resize-none rounded-xl border border-border-primary bg-bg-primary px-3 py-2 text-xs leading-relaxed text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent"
              rows={2}
              disabled={!credentials}
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={busy || (!draft.trim() && pendingAttachments.length === 0) || !credentials}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary text-text-primary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Отправить сообщение"
            >
              <Send size={16} />
            </button>
            </div>
          </div>
        </footer>
      </section>

    </div>
  );
}
