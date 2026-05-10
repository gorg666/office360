import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  getYandexConversations,
  getYandexUserLink,
  sendYandexMessage,
} from "@/services/messengers/yandexBotApi";
const LIGHTS_OUT_UNTIL_KEY = "velo_messenger_lights_out_until";
const LIGHTS_OUT_CHANGED_EVENT = "velo-messenger-lights-out-changed";
const MAX_CONVERSATIONS_CACHE_KEY = "velo_max_conversations:v1";
const MAX_MESSAGES_CACHE_KEY = "velo_max_messages:v1";

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
    subtitle: "Bot API для Мессенджера в Яндекс 360",
    tokenLabel: "OAuth token бота",
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

const PROVIDER_FILTERS: Array<{ id: MessengerProviderId; label: string }> = [
  { id: "max", label: "MAX" },
  { id: "yandex", label: "Яндекс" },
  { id: "telegram", label: "Telegram" },
];

type StripPaneId = "messengerList" | "messengerChat";

const PANE_LABELS: Record<StripPaneId, string> = {
  messengerList: "М",
  messengerChat: "Ч",
};

const DEFAULT_STRIP_ORDER: StripPaneId[] = ["messengerList", "messengerChat"];

const ALL_STRIP_PANE_IDS: StripPaneId[] = ["messengerList", "messengerChat"];
const LAYOUT_STORAGE_KEY = "velo_messenger_pane_layout:v2";
/** Ширины и порядок только колонок мессенджера у обычных маршрутов почты. */
const STRIP_LAYOUT_KEY = "velo_messenger_side_strip:v1";

const DEFAULT_STRIP_WIDTHS: Record<StripPaneId, number> = {
  messengerList: 250,
  messengerChat: 360,
};

const COLUMN_BORDER_CLASS = "overflow-hidden border-l border-border-primary shadow-none";
const COLUMN_DIVIDER_CLASS = "relative z-20 -mx-1.5 w-3 shrink-0 cursor-col-resize bg-transparent before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border-primary hover:before:bg-text-tertiary";
/** Ширина разделителя между колонками списка и чата (соответствует `w-3` у ручки). */
const INNER_STRIP_DIVIDER_PX = 12;

const STRIP_PANE_LIMITS: Record<StripPaneId, { min: number; max: number }> = {
  messengerList: { min: 220, max: 340 },
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

function nextVisibleStripPane(order: StripPaneId[], collapsed: StripPaneId[], paneId: StripPaneId): StripPaneId | null {
  const startIndex = order.indexOf(paneId);
  if (startIndex < 0) return null;
  for (let index = startIndex + 1; index < order.length; index += 1) {
    const candidate = order[index];
    if (candidate && !collapsed.includes(candidate)) return candidate;
  }
  return null;
}

function isLightsOutActive() {
  try {
    const value = localStorage.getItem(LIGHTS_OUT_UNTIL_KEY);
    return value ? Date.now() < Number(value) : false;
  } catch {
    return false;
  }
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
  const [selectedProviderId, setSelectedProviderId] = useState<MessengerProviderId>("max");
  const [activeProviderIds, setActiveProviderIds] = useState<MessengerProviderId[]>(["max", "yandex"]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<MessengerAttachmentUpload[]>([]);
  const [lightsOut, setLightsOut] = useState(() => isLightsOutActive());
  const [busy, setBusy] = useState(false);
  const [, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [paneWidths, setPaneWidths] = useState<Record<StripPaneId, number>>(() =>
    mergeStripWidths(loadSideStripLayout().paneWidths),
  );
  const paneOrder = DEFAULT_STRIP_ORDER;
  const [collapsedPaneIds, setCollapsedPaneIds] = useState<StripPaneId[]>(() => {
    const saved = loadSideStripLayout().collapsedPaneIds;
    if (!Array.isArray(saved)) return [];
    return saved.filter((x): x is StripPaneId => ALL_STRIP_PANE_IDS.includes(x as StripPaneId));
  });
  const [maxCredentials, setMaxCredentials] = useState<MessengerCredentials | null>(() => loadMessengerCredentials("max"));
  const [yandexCredentials, setYandexCredentials] = useState<MessengerCredentials | null>(() => loadMessengerCredentials("yandex"));
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
  const conversationPanelRef = useRef<HTMLElement | null>(null);
  const chatPanelRef = useRef<HTMLElement | null>(null);
  const conversationDividerRef = useRef<HTMLButtonElement | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    leftPane: StripPaneId;
    rightPane: StripPaneId;
    startLeftWidth: number;
    startRightWidth: number;
    totalInner: number;
  } | null>(null);

  const selectedProvider = PROVIDERS.find((provider) => provider.id === selectedProviderId) ?? PROVIDERS[0]!;
  const credentials = selectedProviderId === "max" ? maxCredentials : selectedProviderId === "yandex" ? yandexCredentials : telegramCredentials;

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
    if (selectedConversation?.providerId !== "max" || !maxCredentials || selectedConversation.kind !== "chat") return;
    if (conversationMessages.length > 0) return;

    const cacheKey = selectedConversation.id;
    if (autoLoadedHistoryRef.current.has(cacheKey)) return;
    if (loadingHistoryRef.current.has(cacheKey)) return;
    loadingHistoryRef.current.add(cacheKey);

    void getMaxMessages(maxCredentials.token, selectedConversation.id)
      .then((history) => {
        if (!history.length) {
          autoLoadedHistoryRef.current.delete(cacheKey);
          return;
        }
        autoLoadedHistoryRef.current.add(cacheKey);
        setMessages((current) => ({
          ...current,
          max: mergeMessages(current.max, history),
        }));
      })
      .catch((historyError) => {
        autoLoadedHistoryRef.current.delete(cacheKey);
        setError(historyError instanceof Error ? historyError.message : String(historyError || "Не удалось загрузить историю MAX."));
      })
      .finally(() => {
        loadingHistoryRef.current.delete(cacheKey);
      });
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
    if (conversationPanelRef.current) {
      conversationPanelRef.current.style.width = `${paneWidths.messengerList}px`;
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

    if (conversationDividerRef.current) {
      conversationDividerRef.current.style.order = "1";
      const listVisible = !collapsedPaneIds.includes("messengerList");
      const chatVisible = !collapsedPaneIds.includes("messengerChat");
      conversationDividerRef.current.style.display = listVisible && chatVisible ? "" : "none";
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
      setSelectedProviderId(selectedConversation.providerId);
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

  const startDividerDrag = useCallback((leftPane: StripPaneId, clientX: number) => {
    const rightPane = nextVisibleStripPane(paneOrder, collapsedPaneIds, leftPane);
    if (!rightPane) return;

    const totalInner =
      asideTotalWidth !== undefined
        ? asideTotalWidth - INNER_STRIP_DIVIDER_PX
        : paneWidths[leftPane] + paneWidths[rightPane];

    dragStateRef.current = {
      startX: clientX,
      leftPane,
      rightPane,
      startLeftWidth: paneWidths[leftPane],
      startRightWidth: paneWidths[rightPane],
      totalInner,
    };
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      const delta = event.clientX - dragState.startX;
      const leftLimits = STRIP_PANE_LIMITS[dragState.leftPane];
      const rightLimits = STRIP_PANE_LIMITS[dragState.rightPane];
      const totalWidth = dragState.totalInner;
      const minLeft = Math.max(leftLimits.min, totalWidth - rightLimits.max);
      const maxLeft = Math.min(leftLimits.max, totalWidth - rightLimits.min);
      const nextLeftWidth = clamp(dragState.startLeftWidth + delta, minLeft, maxLeft);
      const nextRightWidth = totalWidth - nextLeftWidth;

      setPaneWidths((current) => ({
        ...current,
        [dragState.leftPane]: nextLeftWidth,
        [dragState.rightPane]: nextRightWidth,
      }));
    };
    const stopDrag = () => {
      dragStateRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDrag);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDrag, { once: true });
  }, [asideTotalWidth, collapsedPaneIds, paneOrder, paneWidths]);

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

  const togglePaneCollapsed = useCallback((paneId: StripPaneId) => {
    setCollapsedPaneIds((current) => {
      if (current.includes(paneId)) return current.filter((id) => id !== paneId);
      if (DEFAULT_STRIP_ORDER.length - current.length <= 1) return current;
      return [...current, paneId];
    });
  }, []);

  const toggleProviderFilter = useCallback((providerId: MessengerProviderId) => {
    setActiveProviderIds((current) => {
      if (current.includes(providerId)) {
        const next = current.filter((id) => id !== providerId);
        return next.length ? next : current;
      }
      return [...current, providerId];
    });
  }, []);

  const saveToken = useCallback(() => {
    const token = tokenInput.trim();
    if (!token) {
      setError("Введите token выбранного провайдера.");
      return;
    }
    const saved = saveMessengerCredentials(selectedProviderId, token);
    if (selectedProviderId === "max") setMaxCredentials(saved);
    if (selectedProviderId === "yandex") setYandexCredentials(saved);
    if (selectedProviderId === "telegram") setTelegramCredentials(saved);
    setTokenInput("");
    setError(null);
    setInfo(`${selectedProvider.name}: token сохранён локально.`);
  }, [selectedProvider.name, selectedProviderId, tokenInput]);

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
    if (selectedProviderId === "yandex") setYandexCredentials(null);
    if (selectedProviderId === "telegram") setTelegramCredentials(null);
    setMessages((current) => ({ ...current, [selectedProviderId]: [] }));
    setConversations((current) => ({ ...current, [selectedProviderId]: [] }));
    setSelectedConversationKey(null);
    setInfo(`${selectedProvider.name}: token удалён.`);
    setError(null);
  }, [selectedProvider.name, selectedProviderId]);

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
      if (!credentials) throw new Error("Сначала сохраните token.");
      if (selectedProviderId === "max") {
        const me = await getMaxMe(credentials.token);
        setMaxProfileId(String(me.user_id));
        setInfo(`MAX token рабочий: ${me.username ?? me.first_name ?? me.name ?? me.user_id}.`);
        return;
      }

      if (targetKind === "login" && targetId.trim()) {
        const link = await getYandexUserLink(credentials.token, targetId.trim());
        if (!link.ok) throw new Error(link.description ?? "Яндекс не подтвердил token/login.");
        setInfo(`Яндекс token рабочий, пользователь найден: ${link.id ?? targetId.trim()}.`);
        return;
      }

      setInfo("Яндекс token сохранён. Для проверки API укажите login и нажмите «Проверить» или отправьте тестовое сообщение.");
    });
  }, [credentials, runAction, selectedProviderId, targetId, targetKind]);

  const refreshConversations = useCallback(() => {
    void runAction(async () => {
      if (!credentials) throw new Error("Сначала сохраните token.");
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

      const yandexConversations = getYandexConversations(loadMessengerTargets("yandex"));
      setConversations((current) => ({ ...current, yandex: yandexConversations }));
      setInfo(
        yandexConversations.length
          ? `Яндекс recent-диалоги загружены: ${yandexConversations.length}.`
          : "У Яндекс Bot API нет общего inbox list: укажите chat_id/login и отправьте сообщение.",
      );
    });
  }, [credentials, runAction, selectedProviderId]);

  const selectConversation = useCallback((conversation: MessengerConversation) => {
    setSelectedConversationKey(`${conversation.providerId}:${conversation.kind}:${conversation.id}`);
    setSelectedProviderId(conversation.providerId);
    setTargetKind(conversation.kind);
    setTargetId(conversation.id);
  }, []);

  const sendMessage = useCallback(() => {
    void runAction(async () => {
      if (!credentials) throw new Error("Сначала сохраните token.");
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
      } else {
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

  return (
    <div
      className="relative flex h-full min-h-0 shrink-0 overflow-hidden bg-bg-primary/45"
      style={asideTotalWidth !== undefined ? { width: asideTotalWidth } : undefined}
    >
      <div className="fixed right-24 top-1.5 z-50 flex items-center gap-1 rounded-lg border border-border-primary bg-bg-secondary/95 px-1.5 py-1 shadow-sm">
        {paneOrder.map((paneId) => {
          const collapsed = collapsedPaneIds.includes(paneId);
          return (
            <button
              key={paneId}
              type="button"
              onClick={() => togglePaneCollapsed(paneId)}
              className={`h-5 min-w-5 rounded border px-1 text-[0.625rem] font-medium transition-colors ${
                collapsed
                  ? "border-border-secondary bg-bg-primary text-text-tertiary"
                  : "border-border-primary bg-bg-tertiary text-text-primary"
              }`}
              title="Показать/скрыть колонку мессенджера. Повторный клик по «Messengers» в сайдбаре скрывает панель."
              aria-label={`Окно ${PANE_LABELS[paneId]}`}
            >
              {PANE_LABELS[paneId]}
            </button>
          );
        })}
      </div>
      <section
        ref={conversationPanelRef}
        className="messenger-slide-panel min-w-[220px] max-w-[340px] shrink-0 overflow-hidden bg-bg-secondary/85 shadow-none"
      >
        <div className="flex h-full flex-col">
          <header className="border-b border-border-primary px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-text-tertiary">Мессенджеры</p>
                <h1 className="text-base font-semibold text-text-primary">Диалоги</h1>
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
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-1.5">
              {PROVIDER_FILTERS.map((provider) => {
                const isActive = activeProviderIds.includes(provider.id);
                return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => toggleProviderFilter(provider.id)}
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

            {showSettings ? <div className="mt-3 grid grid-cols-3 gap-1.5">
              {PROVIDER_FILTERS.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => {
                    setSelectedProviderId(provider.id);
                    setSelectedConversationKey(null);
                    setError(null);
                    setInfo(null);
                    setQuery("");
                  }}
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

            {showSettings ? <div className="mt-4 rounded-2xl border border-border-primary bg-bg-primary/70 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-text-primary">{selectedProvider.subtitle}</p>
                  <p className="mt-1 text-xs text-text-tertiary">
                    {credentials ? `Token сессии сохранён: ${maskMessengerToken(credentials.token)}` : selectedProvider.tokenLabel}
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
                      <div className="grid grid-cols-[1fr_auto] gap-2">
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
                          className="rounded-lg border border-border-primary px-3 py-2 text-xs text-text-secondary hover:border-border-primary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
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
                          <div className="grid grid-cols-2 gap-2">
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
                          <div className="grid grid-cols-[1fr_auto] gap-2">
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
                <input
                  value={tokenInput}
                  onChange={(event) => setTokenInput(event.target.value)}
                  placeholder={selectedProviderId === "max" ? "Или вставьте готовый __oneme_auth token" : selectedProvider.tokenLabel}
                  className="w-full rounded-xl border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                  type="password"
                  aria-label={selectedProvider.tokenLabel}
                />
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={saveToken} className="rounded-xl border border-border-primary bg-bg-tertiary px-3 py-2 text-xs font-medium text-text-primary hover:bg-bg-hover">
                    Сохранить
                  </button>
                  <button
                    type="button"
                    onClick={verifyToken}
                    disabled={busy || !credentials}
                    className="rounded-xl border border-border-primary px-3 py-2 text-xs text-text-secondary hover:border-border-primary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                  >
                    Проверить
                  </button>
                  <button
                    type="button"
                    onClick={refreshConversations}
                    disabled={busy || !credentials}
                    title="Обновить диалоги"
                    aria-label="Обновить диалоги"
                    className="rounded-xl border border-border-primary px-3 py-2 text-xs text-text-secondary hover:border-border-primary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={busy ? "mx-auto animate-spin" : "mx-auto"} />
                  </button>
                </div>
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

          <div className="flex-1 overflow-y-auto p-1.5">
            {visibleConversations.length ? visibleConversations.map((conversation) => {
              const isActive = selectedConversation?.providerId === conversation.providerId && selectedConversation.id === conversation.id && selectedConversation.kind === conversation.kind;
              return (
                <button
                  key={`${conversation.kind}:${conversation.id}`}
                  type="button"
                  onClick={() => selectConversation(conversation)}
                  className={`messenger-chat-row mb-1 flex w-full gap-2 rounded-xl px-2 py-1.5 text-left transition-colors ${
                    isActive ? "bg-bg-tertiary text-text-primary" : "hover:bg-bg-hover text-text-primary"
                  }`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-secondary">
                    {conversation.kind === "chat" ? <Users size={14} /> : conversation.kind === "login" ? <Hash size={14} /> : <Bot size={14} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{conversation.title}</span>
                    <span className="mt-0.5 block truncate text-[0.6875rem] text-text-tertiary">{conversation.lastText ?? conversation.subtitle}</span>
                    <span className="block text-[0.625rem] uppercase tracking-wide text-text-tertiary">
                      {formatTargetKind(conversation.kind)} · {conversation.id}
                    </span>
                  </span>
                </button>
              );
            }) : (
              <div className="rounded-2xl border border-dashed border-border-primary p-4 text-sm text-text-tertiary">
                {selectedProviderId === "max"
                  ? "Войдите по номеру телефона или вставьте текущий MAX session token, затем нажмите «Обновить»."
                  : "Укажите login/chat_id справа и отправьте сообщение. Recent-диалоги появятся здесь."}
              </div>
            )}
          </div>
        </div>
      </section>

      <button
        ref={conversationDividerRef}
        type="button"
        onPointerDown={(event) => {
          event.preventDefault();
          startDividerDrag("messengerList", event.clientX);
        }}
        className={COLUMN_DIVIDER_CLASS}
        aria-label="Изменить ширину списка диалогов"
      />

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

        <div className="flex-1 overflow-y-auto px-4 py-3">
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
