import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Copy, ExternalLink, Filter, Mail, MessageCircle, Pencil, Plus, RefreshCw, Search, Trash2, Users, Video } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useAccountStore } from "@/stores/accountStore";
import { getCalendarEventsInRange } from "@/services/db/calendarEvents";
import { createTelemostConference, deleteTelemostConference, getTelemostConference, TelemostApiError, updateTelemostConference, type TelemostConference } from "@/services/yandex360/telemost";
import { authorizeYandexGrant, hasYandexGrantScopes, TELEMOST_REQUIRED_SCOPES } from "@/services/oauth/yandexUnifiedAuth";
import { bootstrapYandexPassportSession } from "@/services/oauth/yandexAuthSession";
import { isTelemostJoinUrl, openTelemostCreateInBrowser, openTelemostInBrowser as openTelemostInBrowserService, openTelemostEmbedded, openTelemostMeeting, closeTelemostEmbedded, setTelemostEmbeddedBounds, TELEMOST_CREATE_URL } from "@/services/telemost/meetingRenderer";
import { getTelemostCapability, setTelemostCapability, type LocalTelemostMeeting, type TelemostCapability } from "@/services/telemost/capability";
import { createTelemostMeetingWeb } from "@/services/telemost/meetingActions";
import {
  AUTH_CHECK_WATCHDOG_MS,
  DIRECT_JOIN_AUTH_REQUIRED_MESSAGE,
  clearPendingJoin,
  decideAuthRequiredAction,
  invalidateVerifiedBrowserAuth,
  logDirectJoinAuth,
  logRetryReuse,
  markDirectJoinTiming,
  parseTelemostAuthBeacon,
  readPendingJoin,
  rememberVerifiedBrowserAuth,
  reportDirectJoinTiming,
  decideAuthenticatedIdentity,
  startDirectJoinTiming,
  telemostAuthCheckUrl,
  writePendingJoin,
  shouldAllowWebCreate,
  shouldIgnoreDuplicateCreateClick,
  shouldOpenMacosEmbeddedUrl,
  shouldRecheckAfterJoinAuthFailure,
  shouldSkipAuthCheck,
  decideCreateAccountOwner,
  type DirectJoinPhase,
  type DirectJoinTimingMark,
  type PendingJoin,
} from "@/services/telemost/directJoinAuth";
import { cefCreate, cefInitialize, cefNavigate, cefPermissionResponse, cefSetBounds, cefSetVisible, type CefEvent } from "@/services/cef";
import { ServicePageShell } from "./ServicePageShell";
import { navigateToLabel } from "@/router/navigate";
import { openNewCompose } from "@/utils/openComposeWindow";
import { getAccount } from "@/services/db/accounts";
import { getDesktopPlatform, type DesktopPlatform } from "@/utils/desktopPlatform";

type RightPaneMode = "EMPTY" | "CREATE_WEB" | "PREPARE_JOIN" | "MEETING" | "ERROR";
const CREATED_KEY = "office360_telemost_conferences";
const VISITED_KEY = "office360_telemost_visited";
const CEF_PROFILE_READY_KEY = "office360_telemost_cef_profile_ready";
const PREJOIN_VISUAL_TIMEOUT_MESSAGE = "Не удалось открыть экран подключения. Повторите.";
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

function normalizeJoinUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^telemost\.360\.yandex\.ru$/i, "telemost.yandex.ru");
    const id = parsed.pathname.match(/\/j\/(\d+)/)?.[1];
    if (id) return `https://${host}/j/${id}`;
    return `${parsed.protocol}//${host}${parsed.pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
}

function meetingDedupeKey(item: Pick<MeetingEntry, "joinUrl">): string {
  const id = item.joinUrl.match(/\/j\/(\d+)/)?.[1];
  return id ? `telemost:${id}` : normalizeJoinUrl(item.joinUrl);
}

function mergeMeetings(items: MeetingEntry[]): MeetingEntry[] {
  const merged = new Map<string, MeetingEntry>();
  for (const item of items) {
    const key = meetingDedupeKey(item);
    const current = merged.get(key);
    if (!current || item.source === "created" || (item.startTime ?? 0) > (current.startTime ?? 0)) merged.set(key, { ...current, ...item });
  }
  return [...merged.values()].sort((a, b) => (b.startTime ?? b.lastOpenedAt ?? 0) - (a.startTime ?? a.lastOpenedAt ?? 0));
}

export function TelemostPage() {
  const accountId = useAccountStore((state) => state.activeAccountId);
  const activeAccount = useAccountStore((state) => state.accounts.find((item) => item.id === state.activeAccountId) ?? null);
  const hostRef = useRef<HTMLDivElement>(null);
  const meetingSurfaceRef = useRef<HTMLDivElement>(null);
  const joinInputRef = useRef<HTMLInputElement>(null);
  const activeMeetingUrlRef = useRef<string | null>(null);
  const pendingScheduleRef = useRef(false);
  const webCreateOperationRef = useRef<"create" | "schedule" | null>(null);
  const accountSwitchGenerationRef = useRef(0);
  const initializedProfilesRef = useRef(new Set<string>());
  /** Join URL already shown in the same embedded WKWebView after CREATE → /j/. */
  const inPlaceJoinUrlRef = useRef<string | null>(null);
  const lastMeetingBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const pendingJoinRef = useRef<PendingJoin | null>(null);
  const resumedJoinUrlRef = useRef<string | null>(null);
  const directJoinPhaseRef = useRef<DirectJoinPhase>("idle");
  const bootstrapDoneRef = useRef(false);
  const bootstrapInFlightRef = useRef(false);
  const authCheckWatchdogRef = useRef<number | null>(null);
  const createOwnerAccountIdRef = useRef<string | null>(null);
  const usedAuthCacheRef = useRef(false);
  const pageModeRef = useRef<RightPaneMode>("EMPTY");
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
  const [pageMode, setPageMode] = useState<RightPaneMode>("EMPTY");
  const [meetingTitle, setMeetingTitle] = useState("Телемост");
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [joinUrl, setJoinUrl] = useState("");
  const [routingErrorUrl, setRoutingErrorUrl] = useState<string | null>(null);
  const [needsTelemostAccess, setNeedsTelemostAccess] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<"create" | "schedule" | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [capability, setCapability] = useState<TelemostCapability>("UNKNOWN");
  const [webCreateFallback, setWebCreateFallback] = useState<"create" | "schedule" | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [revealOfficialCreate, setRevealOfficialCreate] = useState(false);
  const [joinAuthError, setJoinAuthError] = useState<string | null>(null);
  const [prepareStatus, setPrepareStatus] = useState("Создаём встречу…");
  pageModeRef.current = pageMode;
  const isTelemostMeeting = /^https:\/\/telemost(?:\.360)?\.yandex\.ru\/j\/[^/?#]+/i.test(selectedUrl);
  const isTelemostAuth = /^https:\/\/(?:passport|oauth)\.yandex\.(?:ru|com)\//i.test(selectedUrl);
  const showEmbeddedBrowser = isTelemostMeeting || isTelemostAuth || activeMeetingUrl !== null;
  const useEmbeddedTelemost = desktopPlatform === "windows";

  useEffect(() => {
    if (!joinDialogOpen) return;
    joinInputRef.current?.focus({ preventScroll: true });
  }, [joinDialogOpen]);

  const rememberActiveMeeting = useCallback((url: string | null) => {
    activeMeetingUrlRef.current = url;
    setActiveMeetingUrl(url);
  }, []);

  const clearAuthCheckWatchdog = useCallback(() => {
    if (authCheckWatchdogRef.current !== null) {
      window.clearTimeout(authCheckWatchdogRef.current);
      authCheckWatchdogRef.current = null;
    }
  }, []);

  const returnToIdle = useCallback(() => {
    setAuthRequired(false);
    setRevealOfficialCreate(false);
    setJoinAuthError(null);
    setRoutingErrorUrl(null);
    setError(null);
    inPlaceJoinUrlRef.current = null;
    webCreateOperationRef.current = null;
    bootstrapDoneRef.current = false;
    bootstrapInFlightRef.current = false;
    directJoinPhaseRef.current = "idle";
    resumedJoinUrlRef.current = null;
    clearAuthCheckWatchdog();
    if (serviceAccountId) clearPendingJoin(serviceAccountId);
    pendingJoinRef.current = null;
    createOwnerAccountIdRef.current = null;
    rememberActiveMeeting(null);
    setPageMode("EMPTY");
    void closeTelemostEmbedded().catch(() => undefined);
    void invoke("close_oauth_login_window").catch(() => undefined);
  }, [clearAuthCheckWatchdog, rememberActiveMeeting, serviceAccountId]);

  const failClosedDirectJoin = useCallback((message: string) => {
    logDirectJoinAuth("FAIL_CLOSED");
    invalidateVerifiedBrowserAuth();
    usedAuthCacheRef.current = false;
    directJoinPhaseRef.current = "fail_closed";
    bootstrapDoneRef.current = false;
    bootstrapInFlightRef.current = false;
    clearAuthCheckWatchdog();
    returnToIdle();
    setError(message);
  }, [clearAuthCheckWatchdog, returnToIdle]);

  const failClosedVisualJoin = useCallback((message: string) => {
    const pending = pendingJoinRef.current ?? (serviceAccountId ? readPendingJoin(serviceAccountId) : null);
    logDirectJoinAuth("FAIL_CLOSED");
    directJoinPhaseRef.current = "fail_closed";
    bootstrapDoneRef.current = false;
    bootstrapInFlightRef.current = false;
    resumedJoinUrlRef.current = null;
    clearAuthCheckWatchdog();
    rememberActiveMeeting(null);
    setRoutingErrorUrl(pending?.joinUrl ?? null);
    setError(message);
    setLoading(false);
    setPageMode("ERROR");
    void closeTelemostEmbedded().catch(() => undefined);
  }, [clearAuthCheckWatchdog, rememberActiveMeeting, serviceAccountId]);

  const resumePendingJoin = useCallback(() => {
    const pending = pendingJoinRef.current;
    if (!pending) return;
    if (resumedJoinUrlRef.current === pending.joinUrl) return;
    resumedJoinUrlRef.current = pending.joinUrl;
    logDirectJoinAuth("OPEN_JOIN");
    markDirectJoinTiming("OPEN_JOIN");
    clearAuthCheckWatchdog();
    bootstrapDoneRef.current = false;
    bootstrapInFlightRef.current = false;
    directJoinPhaseRef.current = "open_join";
    setPrepareStatus("Открываем встречу…");
    setJoinAuthError(null);
    setAuthRequired(false);
    setRevealOfficialCreate(false);
    setMeetingTitle(pending.title || `Встреча ${meetingId(pending.joinUrl)}`);
    setSelectedUrl(pending.joinUrl);
    setPageMode("MEETING");
    rememberActiveMeeting(pending.joinUrl);
    void invoke("close_telemost_macos_create").catch(() => undefined);
  }, [clearAuthCheckWatchdog, rememberActiveMeeting]);

  const startPrepareJoin = useCallback((meeting: PendingJoin) => {
    if (!serviceAccountId) return;
    const retrying = pageModeRef.current === "ERROR" || directJoinPhaseRef.current === "fail_closed";
    if (retrying) {
      logDirectJoinAuth("RETRY_REUSE");
      logRetryReuse(meeting.id);
    }
    createOwnerAccountIdRef.current = serviceAccountId;
    webCreateOperationRef.current = null;
    writePendingJoin(serviceAccountId, meeting);
    pendingJoinRef.current = meeting;
    resumedJoinUrlRef.current = null;
    bootstrapDoneRef.current = false;
    bootstrapInFlightRef.current = false;
    setJoinAuthError(null);
    setAuthRequired(false);
    setRevealOfficialCreate(false);
    setRoutingErrorUrl(null);
    setError(null);
    setMeetingTitle(meeting.title || `Встреча ${meetingId(meeting.joinUrl)}`);
    setPageMode("PREPARE_JOIN");
    void invoke("close_telemost_macos_create").catch(() => undefined);
    clearAuthCheckWatchdog();
    if (shouldSkipAuthCheck(serviceAccountId)) {
      usedAuthCacheRef.current = true;
      directJoinPhaseRef.current = "auth_ready";
      logDirectJoinAuth("AUTH_CACHE_HIT");
      markDirectJoinTiming("AUTHENTICATED");
      setPrepareStatus("Открываем встречу…");
      resumePendingJoin();
      return;
    }
    usedAuthCacheRef.current = false;
    directJoinPhaseRef.current = "wk_auth_check";
    logDirectJoinAuth("CHECKING");
    markDirectJoinTiming("AUTH_CHECK_OPEN");
    setPrepareStatus("Проверяем Яндекс ID…");
    rememberActiveMeeting(telemostAuthCheckUrl(meeting.joinUrl));
    authCheckWatchdogRef.current = window.setTimeout(() => {
      if (directJoinPhaseRef.current !== "wk_auth_check" || bootstrapInFlightRef.current) return;
      failClosedDirectJoin(DIRECT_JOIN_AUTH_REQUIRED_MESSAGE);
    }, AUTH_CHECK_WATCHDOG_MS);
  }, [clearAuthCheckWatchdog, failClosedDirectJoin, rememberActiveMeeting, resumePendingJoin, serviceAccountId]);

  const connectPassportSession = useCallback(async () => {
    if (!serviceAccountId) return;
    setAuthorizing(true);
    setError(null);
    try {
      await closeTelemostEmbedded().catch(() => undefined);
      await bootstrapYandexPassportSession(serviceAccountId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось открыть вход в Яндекс ID.");
    } finally {
      setAuthorizing(false);
    }
  }, [serviceAccountId]);

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
    // Do not reset MEETING on telemost-macos-embedded-closed: close is also
    // invoked from effect cleanup (StrictMode remount, reopen, resize unmount).
    const routingError = listen<string>("telemost-macos-routing-error", (event) => {
      console.error("Telemost meeting surface left the allowed meeting flow:", event.payload);
      setRoutingErrorUrl(activeMeetingUrlRef.current);
      setError("Не удалось открыть видеовстречу внутри приложения.");
      setPageMode("ERROR");
      void invoke("close_telemost_macos_spike");
      void closeTelemostEmbedded();
    });
    const degraded = listen("telemost-macos-surface-degraded", () => {
      setRoutingErrorUrl(activeMeetingUrlRef.current);
      setError("Интерфейс Телемоста изменился. Открыть встречу в браузере?");
      setPageMode("ERROR");
      void invoke("close_telemost_macos_spike");
      void closeTelemostEmbedded();
    });
    const leftMeeting = listen("telemost-macos-left", () => {
      returnToIdle();
    });
    const authNeeded = listen<string>("telemost-macos-auth-required", (event) => {
      const beacon = parseTelemostAuthBeacon(String(event.payload ?? ""));
      const storedPending = pendingJoinRef.current ?? (serviceAccountId ? readPendingJoin(serviceAccountId) : null);
      if (storedPending && !pendingJoinRef.current) pendingJoinRef.current = storedPending;
      const action = decideAuthRequiredAction({
        beacon,
        pageMode: pageModeRef.current,
        hasPendingJoin: Boolean(pendingJoinRef.current),
        bootstrapInFlight: bootstrapInFlightRef.current,
        recheckAfterBootstrap: bootstrapDoneRef.current && directJoinPhaseRef.current === "wk_auth_check",
      });
      if (action === "ignore") {
        if (shouldRecheckAfterJoinAuthFailure(beacon, usedAuthCacheRef.current) && pendingJoinRef.current) {
          invalidateVerifiedBrowserAuth();
          usedAuthCacheRef.current = false;
          startPrepareJoin(pendingJoinRef.current);
        }
        return;
      }
      if (action === "fail_closed") {
        failClosedDirectJoin(DIRECT_JOIN_AUTH_REQUIRED_MESSAGE);
        return;
      }
      if (!serviceAccountId) {
        if (action === "bootstrap") failClosedDirectJoin(DIRECT_JOIN_AUTH_REQUIRED_MESSAGE);
        return;
      }
      if (action === "bootstrap") {
        logDirectJoinAuth("REQUIRED");
        logDirectJoinAuth("BOOTSTRAP_START");
        invalidateVerifiedBrowserAuth();
        usedAuthCacheRef.current = false;
        bootstrapInFlightRef.current = true;
        bootstrapDoneRef.current = false;
        directJoinPhaseRef.current = "passport_bootstrap";
        clearAuthCheckWatchdog();
        setAuthRequired(true);
        setJoinAuthError(null);
        rememberActiveMeeting(null);
        void bootstrapYandexPassportSession(serviceAccountId).catch((reason) => {
          bootstrapInFlightRef.current = false;
          failClosedDirectJoin(reason instanceof Error ? reason.message : DIRECT_JOIN_AUTH_REQUIRED_MESSAGE);
        });
        return;
      }
      if (pageModeRef.current !== "CREATE_WEB") return;
      logDirectJoinAuth("REQUIRED");
      logDirectJoinAuth("BOOTSTRAP_START");
      bootstrapInFlightRef.current = true;
      setAuthRequired(true);
      setRevealOfficialCreate(false);
      void bootstrapYandexPassportSession(serviceAccountId).catch((reason) => {
        bootstrapInFlightRef.current = false;
        setError(reason instanceof Error ? reason.message : "Не удалось открыть вход в Яндекс ID.");
      });
    });
    const authResumed = listen("telemost-macos-auth-resumed", () => {
      setAuthRequired(false);
      setRevealOfficialCreate(false);
    });
    const authAuthenticated = listen<string>("telemost-macos-auth-authenticated", (event) => {
      const beacon = parseTelemostAuthBeacon(String(event.payload ?? ""));
      logDirectJoinAuth("AUTHENTICATED");
      markDirectJoinTiming("AUTHENTICATED");
      if (serviceAccountId && beacon.uid) {
        rememberVerifiedBrowserAuth(serviceAccountId, beacon.uid, beacon.login);
      }
      const storedPending = pendingJoinRef.current ?? (serviceAccountId ? readPendingJoin(serviceAccountId) : null);
      if (storedPending && !pendingJoinRef.current) pendingJoinRef.current = storedPending;
      const decision = decideAuthenticatedIdentity({
        beacon,
        pendingJoinUrl: pendingJoinRef.current?.joinUrl ?? null,
        alreadyResumedJoinUrl: resumedJoinUrlRef.current,
        expectedEmail: activeAccount?.email,
      });
      if (decision === "ignore") {
        setAuthRequired(false);
        return;
      }
      if (decision === "mismatch") {
        logDirectJoinAuth("ACCOUNT_MISMATCH");
        failClosedDirectJoin(`В Яндекс ID выбран другой аккаунт${beacon.login ? ` (${beacon.login})` : ""}. Ожидался ${activeAccount?.email ?? "аккаунт Office360"}.`);
        return;
      }
      if (decision === "create_ready") {
        setAuthRequired(false);
        return;
      }
      resumePendingJoin();
    });
    const passportReady = listen("yandex-passport-bootstrap-complete", () => {
      if (directJoinPhaseRef.current === "passport_bootstrap" && pendingJoinRef.current) {
        logDirectJoinAuth("BOOTSTRAP_COMPLETE");
        bootstrapInFlightRef.current = false;
        bootstrapDoneRef.current = true;
        setAuthRequired(false);
        void invoke("close_oauth_login_window").catch(() => undefined);
        const bounds = lastMeetingBoundsRef.current;
        const pending = pendingJoinRef.current;
        if (!serviceAccountId || !bounds || !pending) {
          failClosedDirectJoin(DIRECT_JOIN_AUTH_REQUIRED_MESSAGE);
          return;
        }
        logDirectJoinAuth("RECHECK");
        directJoinPhaseRef.current = "wk_auth_check";
        rememberActiveMeeting(telemostAuthCheckUrl(pending.joinUrl));
        return;
      }
      bootstrapDoneRef.current = true;
      setAuthRequired(false);
      void invoke("close_oauth_login_window").catch(() => undefined);
      const bounds = lastMeetingBoundsRef.current;
      if (desktopPlatform === "macos" && serviceAccountId && bounds && pageModeRef.current === "CREATE_WEB"
        && shouldAllowWebCreate({
          capability: "WEB_ONLY",
          pendingJoinUrl: pendingJoinRef.current?.joinUrl ?? null,
          directJoinPhase: directJoinPhaseRef.current,
          alreadyOpenedJoinUrl: resumedJoinUrlRef.current,
        })) {
        void openTelemostEmbedded("macos", TELEMOST_CREATE_URL, serviceAccountId, bounds).catch(() => undefined);
      }
    });
    const oauthClosed = listen("oauth-window-closed", () => {
      if (directJoinPhaseRef.current !== "passport_bootstrap" || !pendingJoinRef.current || bootstrapDoneRef.current) return;
      failClosedDirectJoin(DIRECT_JOIN_AUTH_REQUIRED_MESSAGE);
    });
    const prejoinTimeout = listen("telemost-macos-prejoin-timeout", () => {
      reportDirectJoinTiming(pendingJoinRef.current?.id ?? "");
      failClosedVisualJoin(PREJOIN_VISUAL_TIMEOUT_MESSAGE);
    });
    const prejoinReady = listen("telemost-macos-prejoin-ready", () => {
      markDirectJoinTiming("STAGE3_READY");
      markDirectJoinTiming("MASK_OFF");
      reportDirectJoinTiming(pendingJoinRef.current?.id ?? "");
      if (serviceAccountId) clearPendingJoin(serviceAccountId);
      pendingJoinRef.current = null;
      directJoinPhaseRef.current = "idle";
    });
    const timing = listen<string>("telemost-macos-timing", (event) => {
      const mark = String(event.payload ?? "") as DirectJoinTimingMark | "TIMEOUT";
      if (mark === "TIMEOUT") {
        reportDirectJoinTiming(pendingJoinRef.current?.id ?? "");
        return;
      }
      markDirectJoinTiming(mark);
      if (mark === "MASK_OFF") reportDirectJoinTiming(pendingJoinRef.current?.id ?? "");
    });
    return () => {
      void routingError.then((stop) => stop());
      void degraded.then((stop) => stop());
      void leftMeeting.then((stop) => stop());
      void authNeeded.then((stop) => stop());
      void authResumed.then((stop) => stop());
      void authAuthenticated.then((stop) => stop());
      void passportReady.then((stop) => stop());
      void oauthClosed.then((stop) => stop());
      void prejoinTimeout.then((stop) => stop());
      void prejoinReady.then((stop) => stop());
      void timing.then((stop) => stop());
    };
  }, [activeAccount?.email, clearAuthCheckWatchdog, desktopPlatform, failClosedDirectJoin, failClosedVisualJoin, rememberActiveMeeting, resumePendingJoin, returnToIdle, serviceAccountId, startPrepareJoin]);

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
      const alreadyOpen = Boolean(activeMeetingUrlRef.current && isTelemostJoinUrl(activeMeetingUrlRef.current)
        && normalizeJoinUrl(activeMeetingUrlRef.current) === normalizeJoinUrl(local.joinUrl));
      if (alreadyOpen) return;
      inPlaceJoinUrlRef.current = local.joinUrl;
      rememberActiveMeeting(local.joinUrl);
      setMeetingTitle("Видеовстреча");
      setAuthRequired(false);
      setRevealOfficialCreate(false);
      setPageMode("MEETING");
      if (webCreateOperationRef.current === "schedule") openCalendarDraft(local.joinUrl);
      webCreateOperationRef.current = null;
    });
    return () => { void createdMeeting.then((stop) => stop()); };
  }, [desktopPlatform, openCalendarDraft, rememberActiveMeeting, serviceAccountId]);

  const startWebCreate = useCallback(async (operation: "create" | "schedule", webOnly = capability === "WEB_ONLY") => {
    if (!desktopPlatform) return;
    if (!shouldAllowWebCreate({
      capability: webOnly ? "WEB_ONLY" : capability,
      pendingJoinUrl: pendingJoinRef.current?.joinUrl ?? (serviceAccountId ? readPendingJoin(serviceAccountId)?.joinUrl ?? null : null),
      directJoinPhase: directJoinPhaseRef.current,
      alreadyOpenedJoinUrl: resumedJoinUrlRef.current,
    })) {
      logDirectJoinAuth("WEB_CREATE_SUPPRESSED");
      return;
    }
    setError(null);
    webCreateOperationRef.current = operation;
    if (desktopPlatform === "macos") {
      createOwnerAccountIdRef.current = serviceAccountId;
      setRoutingErrorUrl(null);
      setWebCreateFallback(null);
      setMeetingTitle(operation === "schedule" ? "Запланировать встречу" : "Новая видеовстреча");
      inPlaceJoinUrlRef.current = null;
      setAuthRequired(false);
      setRevealOfficialCreate(false);
      setPageMode("CREATE_WEB");
      rememberActiveMeeting(TELEMOST_CREATE_URL);
      void invoke("close_telemost_macos_create").catch(() => undefined);
      return;
    }
    try {
      await createTelemostMeetingWeb(desktopPlatform, serviceAccountId ?? accountId ?? undefined);
    } catch (reason) {
      console.error("Embedded Telemost create failed:", reason);
      setWebCreateFallback(operation);
    }
  }, [accountId, capability, desktopPlatform, rememberActiveMeeting, serviceAccountId]);

  const switchTelemostAccount = useCallback(async () => {
    if (desktopPlatform !== "macos" || !serviceAccountId) return;
    setError(null);
    try {
      setPageMode("EMPTY");
      rememberActiveMeeting(null);
      clearPendingJoin(serviceAccountId);
      pendingJoinRef.current = null;
      directJoinPhaseRef.current = "idle";
      invalidateVerifiedBrowserAuth();
      usedAuthCacheRef.current = false;
      await closeTelemostEmbedded().catch(() => undefined);
      await invoke("reset_telemost_macos_profile", { accountKey: serviceAccountId });
      setMeetingTitle("Телемост");
      setAuthRequired(false);
      setRevealOfficialCreate(false);
      setJoinAuthError(null);
    } catch (reason) {
      console.error("Failed to reset the Telemost web profile:", reason);
      setError("Не удалось сменить аккаунт Телемоста.");
    }
  }, [desktopPlatform, rememberActiveMeeting, serviceAccountId]);

  const readMeetingBounds = useCallback(() => {
    const element = meetingSurfaceRef.current;
    if (!element) return null;
    let node: HTMLElement | null = element;
    while (node) {
      if (node.scrollTop) node.scrollTop = 0;
      if (node.scrollLeft) node.scrollLeft = 0;
      node = node.parentElement;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 32 || rect.height < 32) return null;
    const bounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    lastMeetingBoundsRef.current = bounds;
    return bounds;
  }, []);

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

  useEffect(() => {
    let current = true;
    setAccountChecking(true);
    setServiceAccountId(null);
    setCefSessionReady(false);
    pendingScheduleRef.current = false;
    accountSwitchGenerationRef.current += 1;
    rememberActiveMeeting(null);
    setPageMode("EMPTY");
    pendingJoinRef.current = null;
    directJoinPhaseRef.current = "idle";
    createOwnerAccountIdRef.current = null;
    setJoinAuthError(null);
    setCreated([]); setVisited([]); setCalendarMeetings([]); setSelectedUrl("https://telemost.yandex.ru/"); setError(null);
    if (useEmbeddedTelemost) void cefSetVisible(false);
    void closeTelemostEmbedded();
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
      setMeetingTitle(meeting.title || `Встреча ${meetingId(meeting.joinUrl)}`);
      setError(null);
      if (desktopPlatform === "macos") {
        setPageMode("MEETING");
        return;
      }
      void openTelemostMeeting(desktopPlatform, meeting.joinUrl, serviceAccountId ?? accountId ?? undefined).catch(() => openTelemostInBrowser(meeting.joinUrl));
    }
  }, [accountId, calendarMeetings, desktopPlatform, openTelemostInBrowser, rememberActiveMeeting, serviceAccountId, useEmbeddedTelemost]);

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

  const openMeeting = (meeting: MeetingEntry, requirePassport = false) => {
    if (desktopPlatform === null) return;
    if (desktopPlatform === "macos" && requirePassport && serviceAccountId && isTelemostJoinUrl(meeting.joinUrl)) {
      startPrepareJoin({ id: meeting.id, title: meeting.title, joinUrl: meeting.joinUrl });
      return;
    }
    setSelectedCalendarEventId(meeting.calendarEventId ?? null);
    setSelectedUrl(meeting.joinUrl);
    rememberActiveMeeting(meeting.joinUrl);
    setMeetingTitle(meeting.title || `Встреча ${meetingId(meeting.joinUrl)}`);
    setError(null);
    setRoutingErrorUrl(null);
    if (desktopPlatform === "macos") {
      setPageMode("MEETING");
      return;
    }
    void openTelemostMeeting(desktopPlatform, meeting.joinUrl, serviceAccountId ?? accountId ?? undefined).catch(async (reason) => {
      console.error("Telemost meeting renderer failed; using browser fallback:", reason);
      await openTelemostInBrowser(meeting.joinUrl);
    });
  };

  const macosProfile = serviceAccountId ?? accountId ?? "shared";
  const macosWebKitActive = desktopPlatform === "macos"
    && (pageMode === "MEETING" || pageMode === "CREATE_WEB" || pageMode === "PREPARE_JOIN")
    && Boolean(activeMeetingUrl);

  useLayoutEffect(() => {
    if (!macosWebKitActive || !activeMeetingUrl) {
      void closeTelemostEmbedded();
      inPlaceJoinUrlRef.current = null;
      return;
    }

    let cancelled = false;
    let opened = false;
    let observer: ResizeObserver | null = null;
    let retryTimer: number | null = null;
    let frame: number | null = null;

    const syncWebKitSurface = async () => {
      const element = meetingSurfaceRef.current;
      if (element && !observer) {
        observer = new ResizeObserver(() => { void syncWebKitSurface(); });
        observer.observe(element);
        if (element.parentElement) observer.observe(element.parentElement);
      }
      const bounds = readMeetingBounds();
      if (!bounds) {
        retryTimer = window.setTimeout(() => { void syncWebKitSurface(); }, 50);
        return;
      }
      try {
        if (!opened) {
          opened = true;
          const inPlaceJoin = inPlaceJoinUrlRef.current;
          const sameInPlaceJoin = Boolean(
            inPlaceJoin
            && isTelemostJoinUrl(activeMeetingUrl)
            && normalizeJoinUrl(inPlaceJoin) === normalizeJoinUrl(activeMeetingUrl),
          );
          if (sameInPlaceJoin) {
            await setTelemostEmbeddedBounds(bounds);
            if (!cancelled) setLoading(false);
            return;
          }
          inPlaceJoinUrlRef.current = null;
          const ownerAccountId = createOwnerAccountIdRef.current ?? macosProfile;
          if (decideCreateAccountOwner(ownerAccountId, macosProfile) === "mismatch") {
            logDirectJoinAuth("ACCOUNT_OWNER_MISMATCH");
            failClosedDirectJoin("Не удалось открыть Телемост: аккаунт поверхности не совпадает с выбранным.");
            return;
          }
          if (!shouldOpenMacosEmbeddedUrl(activeMeetingUrl, {
            capability,
            pendingJoinUrl: pendingJoinRef.current?.joinUrl ?? null,
            directJoinPhase: directJoinPhaseRef.current,
            alreadyOpenedJoinUrl: resumedJoinUrlRef.current,
          })) {
            logDirectJoinAuth("WEB_CREATE_SUPPRESSED");
            await setTelemostEmbeddedBounds(bounds);
            if (!cancelled) setLoading(false);
            return;
          }
          setLoading(true);
          if (cancelled) return;
          await openTelemostEmbedded("macos", activeMeetingUrl, ownerAccountId, bounds);
          if (cancelled) return;
          if (!cancelled) setLoading(false);
          frame = window.requestAnimationFrame(() => {
            frame = window.requestAnimationFrame(() => { void syncWebKitSurface(); });
          });
        } else {
          await setTelemostEmbeddedBounds(bounds);
        }
      } catch (reason) {
        opened = false;
        if (!cancelled) {
          console.error("macOS WKWebView POC failed:", reason);
          setRoutingErrorUrl(isTelemostJoinUrl(activeMeetingUrl) ? activeMeetingUrl : null);
          setError(`WKWebView POC: ${String(reason)}`);
          setPageMode("ERROR");
          setLoading(false);
        }
      }
    };

    const onWindowChange = () => { void syncWebKitSurface(); };
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);
    void syncWebKitSurface();

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
    };
  }, [activeMeetingUrl, capability, failClosedDirectJoin, macosProfile, macosWebKitActive, readMeetingBounds, serviceAccountId]);

  useEffect(() => {
    return () => {
      if (authCheckWatchdogRef.current !== null) {
        window.clearTimeout(authCheckWatchdogRef.current);
        authCheckWatchdogRef.current = null;
      }
      void closeTelemostEmbedded();
    };
  }, []);

  useLayoutEffect(() => {
    if (!macosWebKitActive || joinDialogOpen) return;
    const bounds = readMeetingBounds();
    if (bounds) void setTelemostEmbeddedBounds(bounds);
  }, [joinDialogOpen, macosWebKitActive, readMeetingBounds]);

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
    if (shouldIgnoreDuplicateCreateClick(directJoinPhaseRef.current)) return;
    setError(null);
    if (activeMeetingUrlRef.current) {
      openCalendarDraft(activeMeetingUrlRef.current);
      return;
    }
    if (capability === "WEB_ONLY") { await startWebCreate("schedule", true); return; }
    if (checkAccess && !await requireTelemostAccess("schedule")) return;
    try {
      const conference = await createTelemostConference({ accountId: serviceAccountId, waitingRoomLevel: "PUBLIC" });
      setTelemostCapability(serviceAccountId, "API_AVAILABLE"); setCapability("API_AVAILABLE");
      const stored: StoredConference = { ...conference, title: "Встреча в Яндекс Телемосте", createdAt: conference.createdAt ?? Math.floor(Date.now() / 1000), lastOpenedAt: null, source: "API_CREATED", remoteConferenceId: conference.id };
      setCreated((items) => [stored, ...items.filter((item) => item.id !== conference.id)]);
      openCalendarDraft(conference.joinUrl);
    } catch (reason) {
      if (reason instanceof TelemostApiError && reason.code === "organization_restricted") {
        setTelemostCapability(serviceAccountId, "WEB_ONLY"); setCapability("WEB_ONLY"); await startWebCreate("schedule", true); return;
      }
      if (reason instanceof TelemostApiError && (reason.code === "missing_scope" || reason.code === "auth")) {
        setPendingOperation("schedule"); setNeedsTelemostAccess(true); return;
      }
      setError(reason instanceof Error ? reason.message : "Не удалось подготовить встречу для календаря.");
    }
  };

  const createConference = async (checkAccess = true) => {
    if (!serviceAccountId || desktopPlatform === null) return;
    if (shouldIgnoreDuplicateCreateClick(directJoinPhaseRef.current)) return;
    if (capability === "WEB_ONLY") { await startWebCreate("create", true); return; }
    if (checkAccess && !await requireTelemostAccess("create")) return;
    try {
      setError(null);
      setPrepareStatus("Создаём встречу…");
      startDirectJoinTiming();
      directJoinPhaseRef.current = "join_url_ready";
      createOwnerAccountIdRef.current = serviceAccountId;
      const title = window.prompt("Название встречи", "Новая встреча")?.trim() || "Новая встреча";
      const scheduledValue = window.prompt("Дата и время (ГГГГ-ММ-ДД ЧЧ:ММ), можно оставить пустым", "")?.trim() ?? "";
      const scheduledDate = scheduledValue ? new Date(scheduledValue.replace(" ", "T")) : null;
      if (scheduledValue && (!scheduledDate || Number.isNaN(scheduledDate.getTime()))) throw new Error("Укажите дату в формате ГГГГ-ММ-ДД ЧЧ:ММ.");
      const inviteEmails = parseInviteEmails(window.prompt("E-mail участников через запятую", "") ?? "");
      markDirectJoinTiming("API_REQUEST_START");
      const conference = await createTelemostConference({ accountId: serviceAccountId, waitingRoomLevel: "PUBLIC", cohostEmails: [], autoSummarization: false });
      markDirectJoinTiming("API_RESPONSE");
      markDirectJoinTiming("JOIN_URL_READY");
      setTelemostCapability(serviceAccountId, "API_AVAILABLE"); setCapability("API_AVAILABLE");
      const stored: StoredConference = { ...conference, title, createdAt: conference.createdAt ?? Math.floor(Date.now() / 1000), scheduledAt: scheduledDate ? Math.floor(scheduledDate.getTime() / 1000) : null, inviteEmails, lastOpenedAt: null, source: "API_CREATED", remoteConferenceId: conference.id };
      setCreated((items) => [stored, ...items.filter((item) => item.id !== conference.id)]);
      if (inviteEmails.length > 0) void inviteToMeeting(stored);
      if (desktopPlatform === "macos") {
        startPrepareJoin({ id: conference.id, title, joinUrl: conference.joinUrl });
      } else {
        directJoinPhaseRef.current = "idle";
        openMeeting({ id: conference.id, title, joinUrl: conference.joinUrl, source: "created", startTime: stored.scheduledAt ?? stored.createdAt ?? undefined });
      }
    } catch (reason) {
      directJoinPhaseRef.current = "idle";
      if (reason instanceof TelemostApiError && reason.code === "organization_restricted") {
        setTelemostCapability(serviceAccountId, "WEB_ONLY"); setCapability("WEB_ONLY"); await startWebCreate("create", true); return;
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

  const deleteCreatedMeeting = async (meeting: MeetingEntry) => {
    if (!serviceAccountId) return;
    if (!window.confirm("Удалить эту встречу? Ссылка перестанет работать.")) return;
    const current = created.find((item) => item.id === meeting.id || item.joinUrl === meeting.joinUrl);
    const remoteId = current?.remoteConferenceId ?? meeting.id;
    try {
      await deleteTelemostConference(serviceAccountId, remoteId);
      setCreated((items) => items.filter((item) => item.id !== meeting.id && item.remoteConferenceId !== remoteId && item.joinUrl !== meeting.joinUrl));
      if (selectedUrl === meeting.joinUrl || selectedCalendarEventId === meeting.calendarEventId) {
        if (pageMode === "MEETING" || pageMode === "PREPARE_JOIN" || pageMode === "CREATE_WEB") returnToIdle();
        else {
          setSelectedUrl("https://telemost.yandex.ru/");
          setSelectedCalendarEventId(null);
        }
      }
    } catch (reason) {
      if (reason instanceof TelemostApiError && (reason.code === "missing_scope" || reason.code === "auth")) {
        setNeedsTelemostAccess(true);
        setError("Чтобы удалять встречи, разрешите доступ к Телемосту повторно.");
        return;
      }
      setError(reason instanceof Error ? reason.message : "Не удалось удалить встречу Телемоста.");
    }
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

  const showMacosTelemostSurface = desktopPlatform === "macos" && (pageMode === "CREATE_WEB" || pageMode === "PREPARE_JOIN" || pageMode === "MEETING");

  return <ServicePageShell lockViewport title="Яндекс Телемост" description={useEmbeddedTelemost ? "Встречи в Office360" : "Встречи активного Яндекс-аккаунта"} actions={<div className="flex flex-wrap gap-2">
    <button className="btn-secondary px-3 py-2 flex gap-2" disabled={desktopPlatform === null} onClick={() => void createConference()}><Plus size={16}/>Новая видеовстреча</button>
    <button className="btn-secondary px-3 py-2 flex gap-2" disabled={desktopPlatform === null} onClick={() => void scheduleConference()}><CalendarDays size={16}/>Запланировать</button>
    <button className="btn-secondary px-3 py-2 flex gap-2" disabled={desktopPlatform === null} onClick={() => { setError(null); setJoinDialogOpen(true); }}><Users size={16}/>Подключиться</button>
    <button className="btn-secondary px-3 py-2 flex gap-2 opacity-60" disabled title="Недоступно на текущем тарифе"><Video size={16}/>Трансляция</button>
    {desktopPlatform === "macos" && <button className="btn-secondary px-3 py-2" disabled={authorizing || !serviceAccountId} onClick={() => void connectPassportSession()}>{authorizing ? "Подключение…" : "Подключить Яндекс ID для сервисов"}</button>}
    {desktopPlatform === "macos" && <button className="btn-secondary px-3 py-2" onClick={() => void switchTelemostAccount()}>Сменить аккаунт Телемоста</button>}
  </div>}>
    {error && pageMode === "EMPTY" && <div className="mb-3 rounded-md bg-danger/10 text-danger p-3 text-sm flex items-center justify-between"><span>{error}</span><button onClick={() => setError(null)}>Закрыть</button></div>}
    {webCreateFallback && <div className="mb-3 rounded-lg border border-border-primary bg-bg-secondary p-4" role="dialog" aria-label="Создание встреч"><div className="font-medium">Не удалось открыть создание встречи внутри Office360.</div><div className="mt-2 text-sm text-text-tertiary">Открыть Телемост в браузере?{webCreateFallback === "schedule" ? " После получения ссылки добавьте её в событие Office360 Calendar." : ""}</div><div className="mt-3 flex gap-2"><button className="btn-primary px-4 py-2" onClick={() => void openTelemostCreateInBrowser().catch(() => setError("Не удалось открыть Телемост в браузере."))}>Открыть Телемост</button><button className="btn-secondary px-4 py-2" onClick={() => { setWebCreateFallback(null); setJoinDialogOpen(true); }}>Подключиться по ссылке</button><button className="btn-secondary px-4 py-2" onClick={() => setWebCreateFallback(null)}>Закрыть</button></div></div>}
    {needsTelemostAccess && <div className="mb-3 rounded-lg border border-accent/30 bg-accent/5 p-4" role="dialog" aria-label="Доступ к Телемосту"><div className="font-medium">Чтобы создавать встречи в Office360, разрешите доступ к Телемосту.</div><button className="btn-primary mt-3 px-4 py-2" disabled={authorizing} onClick={() => void grantTelemostAccess()}>{authorizing ? "Подключение…" : "Разрешить доступ"}</button></div>}
    <div data-testid="telemost-viewport" className="flex h-full min-h-0 flex-col overflow-hidden">
    {joinDialogOpen && <div className="mb-3 shrink-0 rounded-lg border border-border-primary bg-bg-primary p-4" role="dialog" aria-label="Подключиться к встрече">
      <div className="font-medium">Подключиться к встрече</div>
      <div className="mt-1 text-sm text-text-tertiary">Вставьте ссылку Яндекс Телемоста.</div>
      <div data-testid="telemost-join-row" className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
        <input
          aria-label="Ссылка на встречу"
          value={joinUrl}
          onChange={(event) => setJoinUrl(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") connect(); }}
          placeholder="https://telemost.yandex.ru/j/..."
          className="min-w-0 flex-1 basis-64 rounded border border-border-primary bg-bg-secondary px-3 py-2 text-sm"
          ref={joinInputRef}
        />
        <button type="button" className="btn-primary shrink-0 px-4 py-2" onClick={connect}>Подключиться</button>
        <button type="button" className="btn-secondary shrink-0 px-4 py-2" onClick={() => setJoinDialogOpen(false)}>Отмена</button>
      </div>
    </div>}
    <div data-testid="telemost-split" className="grid min-h-0 flex-1 grid-cols-[minmax(220px,400px)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-3 overflow-hidden">
      <aside data-testid="telemost-meeting-list" className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-primary">
        <div className="p-3 border-b border-border-primary"><div className="font-medium">Встречи</div><div className="mt-2 relative"><Search size={14} className="absolute left-2 top-2.5 text-text-tertiary"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск встреч" className="w-full rounded border border-border-primary bg-bg-secondary py-2 pl-8 pr-2 text-sm"/></div></div>
        <div className="p-2 border-b border-border-primary flex gap-1 overflow-x-auto">
          <Filter size={14} className="m-2 text-text-tertiary shrink-0"/>
          {([['all','Все'],['created','Созданные'],['invited','Приглашения'],['visited','Недавние']] as const).map(([value,label]) => <button key={value} onClick={() => setFilter(value)} className={`rounded px-2 py-1 text-xs whitespace-nowrap ${filter === value ? 'bg-accent text-white' : 'bg-bg-secondary hover:bg-bg-hover'}`}>{label}</button>)}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{meetings.length === 0 ? <div className="p-4 text-sm text-text-tertiary">Встречи появятся после создания, приглашения в календаре или первого открытия ссылки.</div> : meetings.map((meeting) => {
          const contacts = meeting.attendees?.filter((person) => person.email && person.email !== meeting.organizerEmail) ?? [];
          const selected = selectedCalendarEventId ? meeting.calendarEventId === selectedCalendarEventId : selectedUrl === meeting.joinUrl;
          return <article key={`${meeting.source}:${meeting.joinUrl}:${meeting.calendarEventId ?? meeting.startTime ?? ''}`} className={`border-b border-border-primary p-3 ${selected ? 'bg-accent/10' : ''}`}>
            <button className="w-full text-left hover:text-accent" onClick={() => openMeeting(meeting, meeting.source === "created")}>
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
              {meeting.source === "created" && <button className="rounded bg-bg-secondary px-2 py-1 text-xs hover:bg-bg-hover inline-flex items-center gap-1 text-danger" onClick={() => void deleteCreatedMeeting(meeting)}><Trash2 size={13}/>Удалить встречу</button>}
            </div>
          </article>;
        })}</div>
      </aside>
      <section data-testid="telemost-right-pane" className={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-primary ${useEmbeddedTelemost || (showMacosTelemostSurface && (pageMode === "MEETING" || authRequired || revealOfficialCreate)) ? "bg-black" : "bg-bg-primary"}`}>
        {useEmbeddedTelemost && <div ref={hostRef} className="absolute inset-0 bg-black"/>}
        {showMacosTelemostSurface && <div id="telemost-meeting-surface" ref={meetingSurfaceRef} className="relative min-h-0 flex-1 overflow-hidden bg-black" aria-label={pageMode === "MEETING" ? "Поверхность встречи Телемоста" : pageMode === "PREPARE_JOIN" ? "Подготовка встречи Телемоста" : "Создание встречи Телемоста"} />}
        {pageMode === "EMPTY" && !useEmbeddedTelemost && desktopPlatform !== null && <div data-testid="telemost-placeholder" className="absolute inset-0 z-10 grid h-full place-items-center overflow-hidden bg-bg-primary text-center p-8"><div><Video size={42} className="mx-auto text-accent"/><div className="mt-4 text-lg font-semibold">Яндекс Телемост</div><div className="mx-auto mt-2 max-w-md text-sm text-text-tertiary">Создайте новую встречу или подключитесь по ссылке.</div>{desktopPlatform === "macos" && serviceAccountId && <button className="btn-secondary mt-4 px-4 py-2" disabled={authorizing} onClick={() => void connectPassportSession()}>{authorizing ? "Подключение…" : "Подключить Яндекс ID для сервисов"}</button>}</div></div>}
        {pageMode === "CREATE_WEB" && !revealOfficialCreate && <div className="absolute inset-0 z-10 grid place-items-center bg-bg-primary text-center p-8" aria-label="Создаём встречу"><div><Video size={42} className="mx-auto text-accent"/><div className="mt-4 text-lg font-semibold">Создаём встречу</div><div className="mx-auto mt-2 max-w-md text-sm text-text-tertiary">{authRequired ? "Нужен вход в Яндекс ID. Гостевая встреча не создаётся." : "Официальный Телемост откроется на экране подключения."}</div></div></div>}
        {pageMode === "PREPARE_JOIN" && <div className="absolute inset-0 z-10 grid place-items-center bg-bg-primary text-center p-8" aria-label="Подготавливаем встречу"><div><Video size={42} className="mx-auto text-accent"/><div className="mt-4 text-lg font-semibold">{prepareStatus}</div><div className="mx-auto mt-2 max-w-md text-sm text-text-tertiary">{joinAuthError ?? (authRequired ? "Откройте окно Яндекс ID. Гостевая встреча не открывается." : "Гостевая встреча не открывается. Домашняя страница не показывается.")}</div>{(joinAuthError || authRequired) && <div className="mt-4 flex justify-center gap-2"><button className="btn-primary px-4 py-2" type="button" onClick={() => { const pending = pendingJoinRef.current ?? (serviceAccountId ? readPendingJoin(serviceAccountId) : null); if (pending) startPrepareJoin(pending); }}>Повторить</button><button className="btn-secondary px-4 py-2" type="button" onClick={returnToIdle}>Отмена</button></div>}</div></div>}
        {pageMode === "ERROR" && <div className="absolute inset-0 z-10 grid place-items-center bg-bg-primary text-center p-8" role="dialog" aria-label="Поверхность Телемоста"><div><div className="text-sm text-danger">{error ?? "Не удалось открыть видеовстречу внутри приложения."}</div><div className="mt-3 flex justify-center gap-2">{routingErrorUrl && <button className="btn-primary px-4 py-2" onClick={() => { const pending = pendingJoinRef.current ?? (serviceAccountId ? readPendingJoin(serviceAccountId) : null); if (pending) startPrepareJoin(pending); else void openMeeting({ id: meetingId(routingErrorUrl), title: meetingTitle, joinUrl: routingErrorUrl, source: "visited" }, true); }}>Повторить</button>}{routingErrorUrl && <button className="btn-secondary px-4 py-2" onClick={() => void openTelemostInBrowser(routingErrorUrl)}>Открыть в браузере</button>}<button className="btn-secondary px-4 py-2" onClick={returnToIdle}>К списку встреч</button></div></div></div>}
        {desktopPlatform === "macos" && authRequired && <div className="absolute left-3 top-3 right-28 z-20 max-w-lg rounded-lg bg-black/80 p-3 text-white pointer-events-none" role="status"><div className="font-medium">Подключите Яндекс ID для сервисов</div><div className="mt-1 text-sm text-white/80">Войдите как {activeAccount?.email ?? "тот же аккаунт, что и почта Office360"}. Это браузерный вход Яндекса — токены OAuth сюда не подставляются.</div></div>}
        {desktopPlatform === "macos" && (pageMode === "MEETING" || pageMode === "PREPARE_JOIN" || authRequired || revealOfficialCreate) && <div className="absolute right-3 top-3 z-20 flex gap-2 pointer-events-auto">
          <button className="rounded bg-black/70 px-3 py-2 text-sm text-white hover:bg-black" type="button" onClick={returnToIdle}>Закрыть</button>
        </div>}
        {useEmbeddedTelemost && !showEmbeddedBrowser && <div className="absolute inset-0 z-10 grid place-items-center bg-bg-primary text-center p-8"><div><Video size={42} className="mx-auto text-accent"/><div className="mt-4 text-lg font-semibold">Выберите действие в верхней панели</div><div className="mt-2 text-sm text-text-tertiary">Создайте, запланируйте или откройте встречу по ссылке.</div></div></div>}
        {useEmbeddedTelemost && <div className="absolute right-3 top-3 z-10 flex gap-2 pointer-events-auto">
          {loading && <span className="rounded bg-black/70 px-2 py-1 text-xs text-white">Загрузка…</span>}
          <button className="rounded bg-black/70 p-2 text-white hover:bg-black" title="Обновить" onClick={() => cefNavigate(selectedUrl)}><RefreshCw size={15}/></button>
          <button className="rounded bg-black/70 p-2 text-white hover:bg-black" title="Копировать ссылку" onClick={() => navigator.clipboard.writeText(selectedUrl)}><Copy size={15}/></button>
          <button className="rounded bg-black/70 p-2 text-white hover:bg-black" title="Открыть ссылку в системном браузере" onClick={() => void openTelemostInBrowser(selectedUrl)}><ExternalLink size={15}/></button>
        </div>}
      </section>
    </div>
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
