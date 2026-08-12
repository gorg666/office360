import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Copy, ExternalLink, Filter, Mail, MessageCircle, Pencil, Plus, RefreshCw, Search, Users, Video } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useAccountStore } from "@/stores/accountStore";
import { getCalendarEventsInRange } from "@/services/db/calendarEvents";
import { createTelemostConference, getTelemostConference, TelemostApiError, updateTelemostConference, type TelemostConference } from "@/services/yandex360/telemost";
import { authorizeYandexGrant, hasYandexGrantScopes, TELEMOST_REQUIRED_SCOPES } from "@/services/oauth/yandexUnifiedAuth";
import { isTelemostJoinUrl, openTelemostCreateInBrowser, openTelemostInBrowser as openTelemostInBrowserService, openTelemostMeeting } from "@/services/telemost/meetingRenderer";
import { getTelemostCapability, setTelemostCapability, type LocalTelemostMeeting, type TelemostCapability } from "@/services/telemost/capability";
import { createTelemostMeetingWeb } from "@/services/telemost/meetingActions";
import { cefCreate, cefInitialize, cefNavigate, cefPermissionResponse, cefSetBounds, cefSetVisible, type CefEvent } from "@/services/cef";
import { ServicePageShell } from "./ServicePageShell";
import { navigateToLabel } from "@/router/navigate";
import { openNewCompose } from "@/utils/openComposeWindow";
import { getAccount } from "@/services/db/accounts";
import { getDesktopPlatform, type DesktopPlatform } from "@/utils/desktopPlatform";

const CREATED_KEY = "office360_telemost_conferences";
const VISITED_KEY = "office360_telemost_visited";
const CEF_PROFILE_READY_KEY = "office360_telemost_cef_profile_ready";
const TELEMost_URL = /https:\/\/telemost(?:\.360)?\.yandex\.ru\/j\/\d+/gi;

type MeetingSource = "created" | "invited" | "visited";
interface MeetingEntry {
  id: string;
  title: string;
  joinUrl: string;
  source: MeetingSource;
  startTime?: number;
  lastOpenedAt?: number;
  endTime?: number;
  organizerEmail?: string;
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
  calendarEventId?: string;
}

interface StoredConference extends TelemostConference, LocalTelemostMeeting {
  inviteEmails?: string[];
}

function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
}

function meetingId(url: string): string {
  return url.match(/\/j\/(\d+)/)?.[1] ?? url;
}

function mergeMeetings(items: MeetingEntry[]): MeetingEntry[] {
  const merged = new Map<string, MeetingEntry>();
  for (const item of items) {
    const key = item.calendarEventId ? `${item.joinUrl}::${item.calendarEventId}` : item.joinUrl;
    const current = merged.get(key);
    if (!current || item.source === "created" || (item.startTime ?? 0) > (current.startTime ?? 0)) merged.set(key, { ...current, ...item });
  }
  return [...merged.values()].sort((a, b) => (b.startTime ?? b.lastOpenedAt ?? 0) - (a.startTime ?? a.lastOpenedAt ?? 0));
}

export function TelemostPage() {
  const accountId = useAccountStore((state) => state.activeAccountId);
  const activeAccount = useAccountStore((state) => state.accounts.find((item) => item.id === state.activeAccountId) ?? null);
  const hostRef = useRef<HTMLDivElement>(null);
  const activeMeetingUrlRef = useRef<string | null>(null);
  const pendingScheduleRef = useRef(false);
  const webCreateOperationRef = useRef<"create" | "schedule" | null>(null);
  const accountSwitchGenerationRef = useRef(0);
  const initializedProfilesRef = useRef(new Set<string>());
  const [serviceAccountId, setServiceAccountId] = useState<string | null>(null);
  const [accountChecking, setAccountChecking] = useState(true);
  const [created, setCreated] = useState<StoredConference[]>([]);
  const [calendarMeetings, setCalendarMeetings] = useState<MeetingEntry[]>([]);
  const [visited, setVisited] = useState<MeetingEntry[]>([]);
  const [selectedUrl, setSelectedUrl] = useState("https://telemost.yandex.ru/");
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | MeetingSource>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cefSessionReady, setCefSessionReady] = useState(false);
  const [activeMeetingUrl, setActiveMeetingUrl] = useState<string | null>(null);
  const [desktopPlatform, setDesktopPlatform] = useState<DesktopPlatform | null>(null);
  const [macosSpikeOpen, setMacosSpikeOpen] = useState(false);
  const [macosSpikeUrl, setMacosSpikeUrl] = useState("");
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [joinUrl, setJoinUrl] = useState("");
  const [routingErrorUrl, setRoutingErrorUrl] = useState<string | null>(null);
  const [needsTelemostAccess, setNeedsTelemostAccess] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<"create" | "schedule" | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [capability, setCapability] = useState<TelemostCapability>("UNKNOWN");
  const [webCreateFallback, setWebCreateFallback] = useState<"create" | "schedule" | null>(null);
  const isTelemostMeeting = /^https:\/\/telemost(?:\.360)?\.yandex\.ru\/j\/[^/?#]+/i.test(selectedUrl);
  const isTelemostAuth = /^https:\/\/(?:passport|oauth)\.yandex\.(?:ru|com)\//i.test(selectedUrl);
  const showEmbeddedBrowser = isTelemostMeeting || isTelemostAuth || activeMeetingUrl !== null;
  const useEmbeddedTelemost = desktopPlatform === "windows";

  const rememberActiveMeeting = useCallback((url: string | null) => {
    activeMeetingUrlRef.current = url;
    setActiveMeetingUrl(url);
  }, []);

  const openCalendarDraft = useCallback((meetingUrl: string) => {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    sessionStorage.setItem("office360_calendar_create_draft", JSON.stringify({
      summary: "Встреча в Яндекс Телемосте", description: `Ссылка на встречу: ${meetingUrl}`,
      location: meetingUrl, startTime: toLocalDateTime(start), endTime: toLocalDateTime(end), attendees: [],
    }));
    navigateToLabel("calendar");
  }, []);

  useEffect(() => {
    let current = true;
    void getDesktopPlatform().then((value) => {
      if (current) setDesktopPlatform(value);
    });
    return () => { current = false; };
  }, []);

  const openTelemostInBrowser = useCallback(async (url: string) => {
    try {
      await openTelemostInBrowserService(url);
    } catch (reason) {
      console.error("Failed to open Telemost in the system browser:", reason);
      setError("Не удалось открыть Телемост в браузере.");
    }
  }, []);

  useEffect(() => {
    if (desktopPlatform !== "macos") return;
    const closed = listen("telemost-macos-spike-closed", () => setMacosSpikeOpen(false));
    const routingError = listen<string>("telemost-macos-routing-error", (event) => {
      console.error("Telemost meeting surface left the allowed meeting flow:", event.payload);
      setRoutingErrorUrl(activeMeetingUrlRef.current);
      setError("Не удалось открыть видеовстречу внутри приложения.");
      setMacosSpikeOpen(false);
      void invoke("close_telemost_macos_spike");
    });
    const degraded = listen("telemost-macos-surface-degraded", () => {
      setRoutingErrorUrl(activeMeetingUrlRef.current);
      setError("Интерфейс Телемоста изменился. Открыть встречу в браузере?");
      setMacosSpikeOpen(false);
      void invoke("close_telemost_macos_spike");
    });
    return () => {
      void closed.then((stop) => stop());
      void routingError.then((stop) => stop());
      void degraded.then((stop) => stop());
    };
  }, [desktopPlatform]);

  useEffect(() => {
    if (desktopPlatform !== "macos" || !serviceAccountId) return;
    const createdMeeting = listen<string>("telemost-macos-created", (event) => {
      if (!isTelemostJoinUrl(event.payload)) return;
      const id = meetingId(event.payload);
      const now = Math.floor(Date.now() / 1000);
      const local: StoredConference = {
        id, title: "Видеовстреча", joinUrl: event.payload, organizer: null,
        createdAt: now, scheduledAt: null, status: null, liveStreamWatchUrl: null,
        lastOpenedAt: null, source: "WEB_CREATED", remoteConferenceId: null,
      };
      setCreated((items) => [local, ...items.filter((item) => item.joinUrl !== local.joinUrl)]);
      setSelectedUrl(local.joinUrl);
      setWebCreateFallback(null);
      void invoke("close_telemost_macos_create");
      rememberActiveMeeting(local.joinUrl);
      if (webCreateOperationRef.current === "schedule") openCalendarDraft(local.joinUrl);
      webCreateOperationRef.current = null;
    });
    return () => { void createdMeeting.then((stop) => stop()); };
  }, [desktopPlatform, openCalendarDraft, rememberActiveMeeting, serviceAccountId]);

  const startWebCreate = useCallback(async (operation: "create" | "schedule") => {
    if (!desktopPlatform) return;
    setError(null);
    webCreateOperationRef.current = operation;
    try {
      await createTelemostMeetingWeb(desktopPlatform, serviceAccountId ?? accountId ?? undefined);
    } catch (reason) {
      console.error("Embedded Telemost create failed:", reason);
      setWebCreateFallback(operation);
    }
  }, [accountId, desktopPlatform, serviceAccountId]);

  const switchTelemostAccount = useCallback(async () => {
    if (desktopPlatform !== "macos" || !serviceAccountId) return;
    setError(null);
    try {
      await invoke("reset_telemost_macos_profile", { accountKey: serviceAccountId });
      await createTelemostMeetingWeb("macos", serviceAccountId);
    } catch (reason) {
      console.error("Failed to reset the Telemost web profile:", reason);
      setError("Не удалось сменить аккаунт Телемоста.");
    }
  }, [desktopPlatform, serviceAccountId]);

  const openMacosSpike = useCallback(async (meetingUrl: string) => {
    const value = meetingUrl.trim();
    if (!value) return;
    if (!isTelemostJoinUrl(value)) {
      setError("Введите корректную ссылку на встречу Телемоста.");
      return;
    }
    setError(null);
    setRoutingErrorUrl(null);
    try {
      await openTelemostMeeting("macos", value, serviceAccountId ?? accountId ?? undefined);
      setMacosSpikeOpen(true);
    } catch (reason) {
      console.error("Telemost WKWebView failed; using browser fallback:", reason);
      await openTelemostInBrowser(value);
    }
  }, [accountId, openTelemostInBrowser, serviceAccountId]);

  const requireTelemostAccess = useCallback(async (operation: "create" | "schedule"): Promise<boolean> => {
    if (!serviceAccountId) return false;
    if (await hasYandexGrantScopes(serviceAccountId, "communications", TELEMOST_REQUIRED_SCOPES)) return true;
    setPendingOperation(operation);
    setNeedsTelemostAccess(true);
    return false;
  }, [serviceAccountId]);

  const grantTelemostAccess = useCallback(async () => {
    if (!serviceAccountId || !pendingOperation) return;
    setAuthorizing(true);
    setError(null);
    try {
      await authorizeYandexGrant(serviceAccountId, "communications");
      if (!await hasYandexGrantScopes(serviceAccountId, "communications", TELEMOST_REQUIRED_SCOPES)) {
        throw new Error("Яндекс не предоставил необходимые разрешения Телемоста.");
      }
      const operation = pendingOperation;
      setNeedsTelemostAccess(false);
      setPendingOperation(null);
      if (operation === "create") await createConference(false);
      else await scheduleConference(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось разрешить доступ к Телемосту.");
    } finally {
      setAuthorizing(false);
    }
  }, [pendingOperation, serviceAccountId]);

  const closeMacosSpike = useCallback(async () => {
    try {
      await invoke("close_telemost_macos_spike");
      setMacosSpikeOpen(false);
    } catch (reason) {
      console.error("Failed to close Telemost WKWebView:", reason);
    }
  }, [serviceAccountId]);

  useEffect(() => {
    let current = true;
    setAccountChecking(true);
    setServiceAccountId(null);
    setCefSessionReady(false);
    pendingScheduleRef.current = false;
    accountSwitchGenerationRef.current += 1;
    rememberActiveMeeting(null);
    setCreated([]); setVisited([]); setCalendarMeetings([]); setSelectedUrl("https://telemost.yandex.ru/"); setError(null);
    if (useEmbeddedTelemost) void cefSetVisible(false);
    if (!accountId) { setAccountChecking(false); return () => { current = false; }; }
    void getAccount(accountId).then((account) => {
      if (!current) return;
      const validId = account?.oauth_provider === "yandex" && account.auth_method === "oauth2" ? accountId : null;
      setServiceAccountId(validId);
      if (validId) {
        setCreated(readJson(`${CREATED_KEY}:${validId}`, []));
        setVisited(readJson(`${VISITED_KEY}:${validId}`, []));
        setCapability(getTelemostCapability(validId));
      } else {
        setCapability("UNKNOWN");
      }
      setAccountChecking(false);
    }).catch((reason) => {
      if (!current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setAccountChecking(false);
    });
    return () => { current = false; };
  }, [accountId, rememberActiveMeeting, useEmbeddedTelemost]);

  useEffect(() => { if (serviceAccountId) localStorage.setItem(`${CREATED_KEY}:${serviceAccountId}`, JSON.stringify(created)); }, [created, serviceAccountId]);
  useEffect(() => { if (serviceAccountId) localStorage.setItem(`${VISITED_KEY}:${serviceAccountId}`, JSON.stringify(visited)); }, [visited, serviceAccountId]);

  useEffect(() => {
    if (!serviceAccountId || !activeAccount || !useEmbeddedTelemost) return;
    let current = true;
    const generation = ++accountSwitchGenerationRef.current;
    void (async () => {
      await cefInitialize();
      if (!current || generation !== accountSwitchGenerationRef.current) return;
      await cefCreate("https://telemost.yandex.ru/", serviceAccountId);
      if (!current || generation !== accountSwitchGenerationRef.current) return;
      const profileReadyKey = `${CEF_PROFILE_READY_KEY}:${serviceAccountId}`;
      if (localStorage.getItem(profileReadyKey) !== "1" && !initializedProfilesRef.current.has(serviceAccountId)) {
        initializedProfilesRef.current.add(serviceAccountId);
        await cefSetVisible(false);
        if (!current || generation !== accountSwitchGenerationRef.current) return;
        const retpath = encodeURIComponent("https://telemost.yandex.ru/");
        const loginHint = encodeURIComponent(activeAccount.email);
        const authUrl = `https://passport.yandex.ru/auth?mode=edit&retpath=${retpath}&login_hint=${loginHint}`;
        await cefNavigate(authUrl);
        if (!current || generation !== accountSwitchGenerationRef.current) return;
        if (current) setSelectedUrl(authUrl);
      }
      if (current) setCefSessionReady(true);
    })().catch((reason) => current && setError(`Не удалось переключить аккаунт Телемоста: ${String(reason)}`));
    return () => { current = false; accountSwitchGenerationRef.current += 1; };
  }, [activeAccount?.email, serviceAccountId, useEmbeddedTelemost]);

  useEffect(() => {
    if (!serviceAccountId) { setCalendarMeetings([]); return; }
    const now = Math.floor(Date.now() / 1000);
    void getCalendarEventsInRange(serviceAccountId, now - 730 * 86400, now + 730 * 86400)
      .then((events) => {
        const result: MeetingEntry[] = [];
        for (const event of events) {
          const text = [event.description, event.location, event.html_link, event.ical_data].filter(Boolean).join(" ");
          for (const match of text.matchAll(TELEMost_URL)) {
            const joinUrl = match[0].replace(/[),.;]+$/, "");
            result.push({
              id: meetingId(joinUrl),
              title: event.summary || `Встреча ${meetingId(joinUrl)}`,
              joinUrl,
              source: "invited",
              startTime: event.start_time,
              endTime: event.end_time,
              organizerEmail: event.organizer_email ?? undefined,
              attendees: parseMeetingAttendees(event.attendees_json),
              calendarEventId: event.id,
            });
          }
        }
        setCalendarMeetings(mergeMeetings(result));
      })
      .catch((reason) => setError(`Не удалось прочитать встречи календаря: ${String(reason)}`));
  }, [serviceAccountId]);

  useEffect(() => {
    if (desktopPlatform === null) return;
    const eventId = sessionStorage.getItem("office360_telemost_open_event_id");
    if (!eventId || calendarMeetings.length === 0) return;
    const meeting = calendarMeetings.find((item) => item.calendarEventId === eventId);
    sessionStorage.removeItem("office360_telemost_open_event_id");
    if (meeting) {
      setSelectedCalendarEventId(meeting.calendarEventId ?? null);
      setSelectedUrl(meeting.joinUrl);
      rememberActiveMeeting(meeting.joinUrl);
      setError(null);
      void openTelemostMeeting(desktopPlatform, meeting.joinUrl, serviceAccountId ?? accountId ?? undefined).catch(() => openTelemostInBrowser(meeting.joinUrl));
    }
  }, [calendarMeetings, desktopPlatform, openTelemostInBrowser, rememberActiveMeeting, useEmbeddedTelemost]);

  useEffect(() => {
    if (!useEmbeddedTelemost) return;
    if (!serviceAccountId || !cefSessionReady) { void cefSetVisible(false); return; }
    let alive = true;
    void cefInitialize().then(() => cefCreate(selectedUrl, serviceAccountId)).catch((reason) => alive && setError(`CEF недоступен: ${String(reason)}`));
    const unlisten = listen<CefEvent>("cef-event", (event) => {
      const { type, payload } = event.payload;
      if (type === "loading" && typeof payload.loading === "boolean") setLoading(payload.loading);
      if (type === "navigation" && typeof payload.url === "string") {
        const meetingUrl = /^https:\/\/telemost(?:\.360)?\.yandex\.ru\/j\/[^/?#]+/i.test(payload.url);
        if (meetingUrl) {
          localStorage.setItem(`${CEF_PROFILE_READY_KEY}:${serviceAccountId}`, "1");
          setSelectedUrl(payload.url);
          rememberActiveMeeting(payload.url);
          const entry: MeetingEntry = { id: meetingId(payload.url), title: `Встреча ${meetingId(payload.url)}`, joinUrl: payload.url, source: "visited", lastOpenedAt: Date.now() };
          setVisited((items) => mergeMeetings([entry, ...items]).slice(0, 100));
          if (webCreateOperationRef.current) {
            const now = Math.floor(Date.now() / 1000);
            const local: StoredConference = {
              id: meetingId(payload.url), title: "Видеовстреча", joinUrl: payload.url,
              organizer: null, createdAt: now, scheduledAt: null, status: null,
              liveStreamWatchUrl: null, lastOpenedAt: null, source: "WEB_CREATED", remoteConferenceId: null,
            };
            setCreated((items) => [local, ...items.filter((item) => item.joinUrl !== local.joinUrl)]);
            if (webCreateOperationRef.current === "schedule") openCalendarDraft(payload.url);
            webCreateOperationRef.current = null;
          }
          if (pendingScheduleRef.current) {
            pendingScheduleRef.current = false;
            openCalendarDraft(payload.url);
          }
        } else {
          setSelectedUrl(payload.url);
        }
      }
      if (type === "telemost-action" && payload.action === "create" && payload.ok === false) {
        pendingScheduleRef.current = false;
        setError("Не удалось найти кнопку создания встречи на странице Телемоста. Обновите страницу и повторите попытку.");
      }
      if (type === "error" && typeof payload.message === "string" && payload.message !== "ERR_ABORTED") setError(payload.message);
      if (type === "permission-request" && typeof payload.id === "number" && typeof payload.origin === "string") {
        const allow = window.confirm(`Разрешить камеру и микрофон для ${payload.origin}?`);
        void cefPermissionResponse(payload.id, allow);
      }
    });
    return () => { alive = false; void cefSetVisible(false); void unlisten.then((fn) => fn()); };
  }, [cefSessionReady, openCalendarDraft, rememberActiveMeeting, serviceAccountId, useEmbeddedTelemost]);

  const syncBounds = useCallback(() => {
    const element = hostRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    void cefSetBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height, deviceScaleFactor: window.devicePixelRatio || 1 });
  }, []);

  useEffect(() => {
    if (!useEmbeddedTelemost) return;
    if (!serviceAccountId || !cefSessionReady || !showEmbeddedBrowser) { void cefSetVisible(false); return; }
    const element = hostRef.current;
    if (!element) return;
    const observer = new ResizeObserver(syncBounds);
    observer.observe(element);
    window.addEventListener("resize", syncBounds);
    window.addEventListener("scroll", syncBounds, true);
    syncBounds();
    void cefSetVisible(true);
    return () => { observer.disconnect(); window.removeEventListener("resize", syncBounds); window.removeEventListener("scroll", syncBounds, true); void cefSetVisible(false); };
  }, [cefSessionReady, serviceAccountId, showEmbeddedBrowser, syncBounds, useEmbeddedTelemost]);

  const meetings = useMemo(() => {
    const fromCreated: MeetingEntry[] = created.map((item) => ({
      id: item.id,
      title: item.title || `Встреча ${item.id}`,
      joinUrl: item.joinUrl,
      source: "created",
      startTime: item.scheduledAt ?? item.createdAt ?? undefined,
      attendees: (item.inviteEmails ?? []).map((email) => ({ email })),
    }));
    const normalized = query.trim().toLowerCase();
    const result = mergeMeetings([...fromCreated, ...calendarMeetings, ...visited]).filter((item) =>
      (filter === "all" || item.source === filter) && (!normalized || `${item.title} ${item.joinUrl}`.toLowerCase().includes(normalized)),
    );
    if (!selectedCalendarEventId) return result;
    return result.sort((a, b) => Number(b.calendarEventId === selectedCalendarEventId) - Number(a.calendarEventId === selectedCalendarEventId));
  }, [calendarMeetings, created, filter, query, selectedCalendarEventId, visited]);

  const openMeeting = (meeting: MeetingEntry) => {
    if (desktopPlatform === null) return;
    setSelectedCalendarEventId(meeting.calendarEventId ?? null);
    setSelectedUrl(meeting.joinUrl);
    rememberActiveMeeting(meeting.joinUrl);
    setError(null);
    void openTelemostMeeting(desktopPlatform, meeting.joinUrl, serviceAccountId ?? accountId ?? undefined).catch(async (reason) => {
      console.error("Telemost meeting renderer failed; using browser fallback:", reason);
      await openTelemostInBrowser(meeting.joinUrl);
    });
  };

  const openCalendarEvent = (meeting: MeetingEntry) => {
    if (!meeting.calendarEventId) return;
    sessionStorage.setItem("office360_calendar_open_event_id", meeting.calendarEventId);
    navigateToLabel("calendar");
  };

  const openMessenger = () => {
    navigateToLabel("messengers");
    window.dispatchEvent(new CustomEvent("office360:open-yandex-messenger"));
  };

  const connect = () => {
    const value = joinUrl.trim();
    if (!value) return;
    const url = /^https:\/\//i.test(value) ? value : `https://telemost.yandex.ru/j/${value.replace(/\D/g, "")}`;
    if (!/^https:\/\/telemost(?:\.360)?\.yandex\.ru\/j\/\d+/i.test(url)) {
      setError("Введите корректную ссылку или номер встречи Телемоста.");
      return;
    }
    setJoinDialogOpen(false);
    setJoinUrl("");
    openMeeting({ id: meetingId(url), title: `Встреча ${meetingId(url)}`, joinUrl: url, source: "visited" });
  };

  const scheduleConference = async (checkAccess = true) => {
    if (!serviceAccountId || desktopPlatform === null) return;
    setError(null);
    if (activeMeetingUrlRef.current) {
      openCalendarDraft(activeMeetingUrlRef.current);
      return;
    }
    if (capability === "WEB_ONLY") { await startWebCreate("schedule"); return; }
    if (checkAccess && !await requireTelemostAccess("schedule")) return;
    try {
      const conference = await createTelemostConference({ accountId: serviceAccountId, waitingRoomLevel: "PUBLIC" });
      setTelemostCapability(serviceAccountId, "API_AVAILABLE"); setCapability("API_AVAILABLE");
      const stored: StoredConference = { ...conference, title: "Встреча в Яндекс Телемосте", createdAt: conference.createdAt ?? Math.floor(Date.now() / 1000), lastOpenedAt: null, source: "API_CREATED", remoteConferenceId: conference.id };
      setCreated((items) => [stored, ...items.filter((item) => item.id !== conference.id)]);
      openCalendarDraft(conference.joinUrl);
    } catch (reason) {
      if (reason instanceof TelemostApiError && reason.code === "organization_restricted") {
        setTelemostCapability(serviceAccountId, "WEB_ONLY"); setCapability("WEB_ONLY"); await startWebCreate("schedule"); return;
      }
      if (reason instanceof TelemostApiError && (reason.code === "missing_scope" || reason.code === "auth")) {
        setPendingOperation("schedule"); setNeedsTelemostAccess(true); return;
      }
      setError(reason instanceof Error ? reason.message : "Не удалось подготовить встречу для календаря.");
    }
  };

  const createConference = async (checkAccess = true) => {
    if (!serviceAccountId || desktopPlatform === null) return;
    if (capability === "WEB_ONLY") { await startWebCreate("create"); return; }
    if (checkAccess && !await requireTelemostAccess("create")) return;
    try {
      setError(null);
      const title = window.prompt("Название встречи", "Новая встреча")?.trim() || "Новая встреча";
      const scheduledValue = window.prompt("Дата и время (ГГГГ-ММ-ДД ЧЧ:ММ), можно оставить пустым", "")?.trim() ?? "";
      const scheduledDate = scheduledValue ? new Date(scheduledValue.replace(" ", "T")) : null;
      if (scheduledValue && (!scheduledDate || Number.isNaN(scheduledDate.getTime()))) throw new Error("Укажите дату в формате ГГГГ-ММ-ДД ЧЧ:ММ.");
      const inviteEmails = parseInviteEmails(window.prompt("E-mail участников через запятую", "") ?? "");
      const conference = await createTelemostConference({ accountId: serviceAccountId, waitingRoomLevel: "PUBLIC", cohostEmails: [], autoSummarization: false });
      setTelemostCapability(serviceAccountId, "API_AVAILABLE"); setCapability("API_AVAILABLE");
      const stored: StoredConference = { ...conference, title, createdAt: conference.createdAt ?? Math.floor(Date.now() / 1000), scheduledAt: scheduledDate ? Math.floor(scheduledDate.getTime() / 1000) : null, inviteEmails, lastOpenedAt: null, source: "API_CREATED", remoteConferenceId: conference.id };
      setCreated((items) => [stored, ...items.filter((item) => item.id !== conference.id)]);
      if (inviteEmails.length > 0) void inviteToMeeting(stored);
      openMeeting({ id: conference.id, title, joinUrl: conference.joinUrl, source: "created", startTime: stored.scheduledAt ?? stored.createdAt ?? undefined });
    } catch (reason) {
      if (reason instanceof TelemostApiError && reason.code === "organization_restricted") {
        setTelemostCapability(serviceAccountId, "WEB_ONLY"); setCapability("WEB_ONLY"); await startWebCreate("create"); return;
      }
      if (reason instanceof TelemostApiError && (reason.code === "missing_scope" || reason.code === "auth")) {
        setPendingOperation("create"); setNeedsTelemostAccess(true); return;
      }
      setError(reason instanceof Error ? reason.message : "Не удалось создать встречу Телемоста.");
    }
  };

  const editCreated = (meeting: MeetingEntry) => {
    const current = created.find((item) => item.id === meeting.id);
    if (!current) return;
    const title = window.prompt("Название встречи", current.title || meeting.title)?.trim();
    if (!title) return;
    const emails = parseInviteEmails(window.prompt("E-mail участников через запятую", (current.inviteEmails ?? []).join(", ")) ?? "");
    const waitingRoomLevel = current.waitingRoomLevel && current.waitingRoomLevel !== "UNKNOWN" ? current.waitingRoomLevel : "PUBLIC";
    void updateTelemostConference({ accountId: serviceAccountId, id: meeting.id, waitingRoomLevel })
      .then(() => getTelemostConference(serviceAccountId, meeting.id))
      .then((fresh) => setCreated((items) => items.map((item) => item.id === meeting.id ? { ...item, ...fresh, title, inviteEmails: emails } : item)))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось изменить встречу."));
  };

  const inviteToMeeting = (conference: StoredConference | MeetingEntry) => {
    const emails = "inviteEmails" in conference
      ? conference.inviteEmails ?? []
      : (conference as MeetingEntry).attendees?.map((item) => item.email) ?? [];
    return openNewCompose({
      to: emails,
      subject: `Приглашение: ${conference.title || `Встреча ${conference.id}`}`,
      bodyHtml: `<p>Приглашаю вас на встречу в Яндекс Телемосте.</p><p><a href="${conference.joinUrl}">${conference.joinUrl}</a></p>`,
    });
  };

  if (!accountChecking && !serviceAccountId) {
    return <ServicePageShell title="Яндекс Телемост" description="Встречи активного Яндекс-аккаунта">
      <div className="rounded-lg border border-border-primary p-8 text-center">
        <div className="font-medium">Телемост недоступен для активного аккаунта</div>
        <div className="mt-2 text-sm text-text-tertiary">{activeAccount?.email ?? "Аккаунт не выбран"} не подключён через Яндекс ID. Выберите подключённый Яндекс-аккаунт.</div>
      </div>
    </ServicePageShell>;
  }

  return <ServicePageShell title="Яндекс Телемост" description={useEmbeddedTelemost ? "Встречи в Office360" : "Встречи активного Яндекс-аккаунта"} actions={<div className="flex flex-wrap gap-2">
    <button className="btn-secondary px-3 py-2 flex gap-2" disabled={desktopPlatform === null} onClick={() => void createConference()}><Plus size={16}/>Новая видеовстреча</button>
    <button className="btn-secondary px-3 py-2 flex gap-2" disabled={desktopPlatform === null} onClick={() => void scheduleConference()}><CalendarDays size={16}/>Запланировать</button>
    <button className="btn-secondary px-3 py-2 flex gap-2" disabled={desktopPlatform === null} onClick={() => { setError(null); setJoinDialogOpen(true); }}><Users size={16}/>Подключиться</button>
    <button className="btn-secondary px-3 py-2 flex gap-2 opacity-60" disabled title="Недоступно на текущем тарифе"><Video size={16}/>Трансляция</button>
    {import.meta.env.DEV && desktopPlatform === "macos" && <input aria-label="Экспериментальная ссылка Телемоста" className="min-w-72 rounded border border-border-primary bg-bg-secondary px-3 py-2 text-sm" placeholder="https://telemost.yandex.ru/j/..." value={macosSpikeUrl} onChange={(event) => setMacosSpikeUrl(event.target.value)}/>}
    {import.meta.env.DEV && desktopPlatform === "macos" && <button className="btn-secondary px-3 py-2 flex gap-2" onClick={() => void openMacosSpike(macosSpikeUrl)}><Video size={16}/>Открыть внутри Office360 (экспериментально)</button>}
    {desktopPlatform === "macos" && macosSpikeOpen && <button className="btn-secondary px-3 py-2" onClick={() => void closeMacosSpike()}>Закрыть окно встречи</button>}
    {desktopPlatform === "macos" && <button className="btn-secondary px-3 py-2" onClick={() => void switchTelemostAccount()}>Сменить аккаунт Телемоста</button>}
  </div>}>
    {error && <div className="mb-3 rounded-md bg-danger/10 text-danger p-3 text-sm flex items-center justify-between"><span>{error}</span><button onClick={() => setError(null)}>Закрыть</button></div>}
    {webCreateFallback && <div className="mb-3 rounded-lg border border-border-primary bg-bg-secondary p-4" role="dialog" aria-label="Создание встреч"><div className="font-medium">Не удалось открыть создание встречи внутри Office360.</div><div className="mt-2 text-sm text-text-tertiary">Открыть Телемост в браузере?{webCreateFallback === "schedule" ? " После получения ссылки добавьте её в событие Office360 Calendar." : ""}</div><div className="mt-3 flex gap-2"><button className="btn-primary px-4 py-2" onClick={() => void openTelemostCreateInBrowser().catch(() => setError("Не удалось открыть Телемост в браузере."))}>Открыть Телемост</button><button className="btn-secondary px-4 py-2" onClick={() => { setWebCreateFallback(null); setJoinDialogOpen(true); }}>Подключиться по ссылке</button><button className="btn-secondary px-4 py-2" onClick={() => setWebCreateFallback(null)}>Закрыть</button></div></div>}
    {needsTelemostAccess && <div className="mb-3 rounded-lg border border-accent/30 bg-accent/5 p-4" role="dialog" aria-label="Доступ к Телемосту"><div className="font-medium">Чтобы создавать встречи в Office360, разрешите доступ к Телемосту.</div><button className="btn-primary mt-3 px-4 py-2" disabled={authorizing} onClick={() => void grantTelemostAccess()}>{authorizing ? "Подключение…" : "Разрешить доступ"}</button></div>}
    {joinDialogOpen && <div className="mb-3 rounded-lg border border-border-primary bg-bg-primary p-4" role="dialog" aria-label="Подключиться к встрече">
      <div className="font-medium">Подключиться к встрече</div>
      <div className="mt-1 text-sm text-text-tertiary">Вставьте ссылку Яндекс Телемоста.</div>
      <div className="mt-3 flex gap-2"><input autoFocus aria-label="Ссылка на встречу" value={joinUrl} onChange={(event) => setJoinUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") connect(); }} placeholder="https://telemost.yandex.ru/j/..." className="min-w-0 flex-1 rounded border border-border-primary bg-bg-secondary px-3 py-2 text-sm"/><button className="btn-primary px-4 py-2" onClick={connect}>Подключиться</button><button className="btn-secondary px-4 py-2" onClick={() => setJoinDialogOpen(false)}>Отмена</button></div>
    </div>}
    <div className="h-full min-h-[650px] grid grid-cols-[400px_minmax(0,1fr)] gap-3">
      <aside className="border border-border-primary rounded-lg overflow-hidden flex flex-col bg-bg-primary">
        <div className="p-3 border-b border-border-primary"><div className="font-medium">Встречи</div><div className="mt-2 relative"><Search size={14} className="absolute left-2 top-2.5 text-text-tertiary"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск встреч" className="w-full rounded border border-border-primary bg-bg-secondary py-2 pl-8 pr-2 text-sm"/></div></div>
        <div className="p-2 border-b border-border-primary flex gap-1 overflow-x-auto">
          <Filter size={14} className="m-2 text-text-tertiary shrink-0"/>
          {([['all','Все'],['created','Созданные'],['invited','Приглашения'],['visited','Недавние']] as const).map(([value,label]) => <button key={value} onClick={() => setFilter(value)} className={`rounded px-2 py-1 text-xs whitespace-nowrap ${filter === value ? 'bg-accent text-white' : 'bg-bg-secondary hover:bg-bg-hover'}`}>{label}</button>)}
        </div>
        <div className="overflow-auto flex-1">{meetings.length === 0 ? <div className="p-4 text-sm text-text-tertiary">Встречи появятся после создания, приглашения в календаре или первого открытия ссылки.</div> : meetings.map((meeting) => {
          const contacts = meeting.attendees?.filter((person) => person.email && person.email !== meeting.organizerEmail) ?? [];
          const selected = selectedCalendarEventId ? meeting.calendarEventId === selectedCalendarEventId : selectedUrl === meeting.joinUrl;
          return <article key={`${meeting.source}:${meeting.joinUrl}:${meeting.calendarEventId ?? meeting.startTime ?? ''}`} className={`border-b border-border-primary p-3 ${selected ? 'bg-accent/10' : ''}`}>
            <button className="w-full text-left hover:text-accent" onClick={() => openMeeting(meeting)}>
              <div className="flex gap-2 items-center"><Video size={15} className="shrink-0"/><span className="truncate font-medium">{meeting.title}</span></div>
              <div className="mt-1 text-xs text-text-tertiary">{meeting.organizerEmail ? `Организатор: ${meeting.organizerEmail}` : meeting.source === 'created' ? 'Создана вами' : meeting.source === 'visited' ? 'Вы открывали' : 'Организатор не указан'}</div>
              {meeting.startTime && <div className="mt-1 text-xs text-text-secondary">{formatMeetingTime(meeting)}</div>}
            </button>
            <div className="mt-2 flex flex-wrap gap-1">
              {(meeting.attendees?.length ?? 0) > 0 && <details className="relative"><summary className="list-none cursor-pointer rounded bg-bg-secondary px-2 py-1 text-xs hover:bg-bg-hover inline-flex items-center gap-1"><Users size={13}/>Участники ({meeting.attendees?.length})</summary><div className="mt-1 rounded border border-border-primary bg-bg-primary p-2 text-xs space-y-1">{meeting.attendees?.map((person) => <div key={person.email} className="flex items-center justify-between gap-2"><span className="truncate" title={person.email}>{person.displayName || person.email}</span><button title="Написать письмо" onClick={() => void openNewCompose({ to: [person.email] })}><Mail size={13}/></button></div>)}</div></details>}
              <button className="rounded bg-bg-secondary px-2 py-1 text-xs hover:bg-bg-hover inline-flex items-center gap-1" title="Открыть Яндекс Мессенджер" onClick={openMessenger}><MessageCircle size={13}/>Чат</button>
              {meeting.calendarEventId && <button className="rounded bg-bg-secondary px-2 py-1 text-xs hover:bg-bg-hover inline-flex items-center gap-1" onClick={() => openCalendarEvent(meeting)}><CalendarDays size={13}/>Календарь</button>}
              {meeting.organizerEmail && <button className="rounded bg-bg-secondary px-2 py-1 text-xs hover:bg-bg-hover inline-flex items-center gap-1" onClick={() => void openNewCompose({ to: [meeting.organizerEmail!] })}><Mail size={13}/>Организатору</button>}
              {contacts.length > 0 && <button className="rounded bg-bg-secondary px-2 py-1 text-xs hover:bg-bg-hover inline-flex items-center gap-1" onClick={() => void openNewCompose({ to: contacts.map((person) => person.email) })}><Mail size={13}/>Участникам</button>}
              {meeting.source === "created" && <button className="rounded bg-bg-secondary px-2 py-1 text-xs hover:bg-bg-hover inline-flex items-center gap-1" onClick={() => void inviteToMeeting(meeting)}><Mail size={13}/>Пригласить</button>}
              {meeting.source === "created" && <button className="rounded bg-bg-secondary px-2 py-1 text-xs hover:bg-bg-hover inline-flex items-center gap-1" onClick={() => void navigator.clipboard.writeText(meeting.joinUrl)}><Copy size={13}/>Ссылка</button>}
              {meeting.source === "created" && <button className="rounded bg-bg-secondary px-2 py-1 text-xs hover:bg-bg-hover inline-flex items-center gap-1" onClick={() => editCreated(meeting)}><Pencil size={13}/>Изменить</button>}
            </div>
          </article>;
        })}</div>
      </aside>
      <section className={`relative border border-border-primary rounded-lg overflow-hidden min-w-0 ${useEmbeddedTelemost ? "bg-black" : "bg-bg-primary"}`}>
        {useEmbeddedTelemost && <div ref={hostRef} className="absolute inset-0 bg-black"/>}
        {!useEmbeddedTelemost && desktopPlatform !== null && <div className="absolute inset-0 z-10 grid place-items-center bg-bg-primary text-center p-8"><div><Video size={42} className="mx-auto text-accent"/><div className="mt-4 text-lg font-semibold">Встречи внутри Office360</div><div className="mx-auto mt-2 max-w-md text-sm text-text-tertiary">Выберите встречу в списке или подключитесь по ссылке. Видеовстреча откроется в отдельном окне Office360.</div>{isTelemostJoinUrl(selectedUrl) && !routingErrorUrl && <div className="mt-5 flex justify-center gap-2"><button className="btn-primary px-4 py-2 inline-flex items-center gap-2" onClick={() => desktopPlatform === "macos" ? void openMacosSpike(selectedUrl) : void openTelemostInBrowser(selectedUrl)}><Video size={16}/>Подключиться</button><button className="btn-secondary px-4 py-2 inline-flex items-center gap-2" onClick={() => void openTelemostInBrowser(selectedUrl)}><ExternalLink size={16}/>Открыть в браузере</button></div>}{routingErrorUrl && <div className="mt-5" role="dialog" aria-label="Поверхность Телемоста"><div className="text-sm text-danger">{error ?? "Не удалось открыть видеовстречу внутри приложения."}</div><div className="mt-3 flex justify-center gap-2"><button className="btn-primary px-4 py-2" onClick={() => void openMacosSpike(routingErrorUrl)}>Повторить</button><button className="btn-secondary px-4 py-2" onClick={() => void openTelemostInBrowser(routingErrorUrl)}>Открыть в браузере</button></div></div>}</div></div>}
        {useEmbeddedTelemost && !showEmbeddedBrowser && <div className="absolute inset-0 z-10 grid place-items-center bg-bg-primary text-center p-8"><div><Video size={42} className="mx-auto text-accent"/><div className="mt-4 text-lg font-semibold">Выберите действие в верхней панели</div><div className="mt-2 text-sm text-text-tertiary">Создайте, запланируйте или откройте встречу по ссылке.</div></div></div>}
        {useEmbeddedTelemost && <div className="absolute right-3 top-3 z-10 flex gap-2 pointer-events-auto">
          {loading && <span className="rounded bg-black/70 px-2 py-1 text-xs text-white">Загрузка…</span>}
          <button className="rounded bg-black/70 p-2 text-white hover:bg-black" title="Обновить" onClick={() => cefNavigate(selectedUrl)}><RefreshCw size={15}/></button>
          <button className="rounded bg-black/70 p-2 text-white hover:bg-black" title="Копировать ссылку" onClick={() => navigator.clipboard.writeText(selectedUrl)}><Copy size={15}/></button>
          <button className="rounded bg-black/70 p-2 text-white hover:bg-black" title="Открыть ссылку в системном браузере" onClick={() => void openTelemostInBrowser(selectedUrl)}><ExternalLink size={15}/></button>
        </div>}
      </section>
    </div>
  </ServicePageShell>;
}

function parseMeetingAttendees(value: string | null): MeetingEntry["attendees"] {
  try { return value ? JSON.parse(value) as NonNullable<MeetingEntry["attendees"]> : []; } catch { return []; }
}

function parseInviteEmails(value: string): string[] {
  return [...new Set(value.split(/[;,\s]+/).map((email) => email.trim()).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
}

function formatMeetingTime(meeting: MeetingEntry): string {
  const start = new Date((meeting.startTime ?? 0) * 1000);
  const formatted = start.toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  if (!meeting.endTime) return formatted;
  const minutes = Math.max(0, Math.round((meeting.endTime - (meeting.startTime ?? meeting.endTime)) / 60));
  return `${formatted} · ${meeting.endTime * 1000 < Date.now() ? "по календарю длилась" : "запланировано"} ${minutes} мин`;
}

function toLocalDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
