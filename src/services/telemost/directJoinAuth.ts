import { normalizeEmail } from "@/utils/emailUtils";

export const TELEMOST_AUTH_CHECK_PARAM = "office360-auth-check";
const PENDING_KEY_PREFIX = "office360_telemost_pending_join";

export type DirectJoinPhase =
  | "idle"
  | "join_url_ready"
  | "wk_auth_check"
  | "passport_bootstrap"
  | "auth_ready"
  | "open_join"
  | "fail_closed";

export type TelemostAuthSurface = "create" | "check" | "join" | "unknown";

export type TelemostAuthBeacon = {
  state: "CHECKING" | "AUTHENTICATED" | "REQUIRED" | "TIMEOUT" | "UNKNOWN";
  uid: string;
  login: string;
  surface: TelemostAuthSurface;
};

export type PendingJoin = {
  id: string;
  title: string;
  joinUrl: string;
  ownerAccountId: string;
  expectedUid?: string;
  expectedLogin?: string;
  epoch: number;
};

export type PassportMatch = "match" | "mismatch" | "unknown";

export function pendingJoinStorageKey(accountId: string): string {
  return `${PENDING_KEY_PREFIX}:${accountId}`;
}

export function readPendingJoin(accountId: string): PendingJoin | null {
  try {
    const raw = sessionStorage.getItem(pendingJoinStorageKey(accountId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingJoin>;
    if (!parsed.joinUrl || !parsed.id) return null;
    const ownerAccountId = String(parsed.ownerAccountId ?? "").trim();
    const epoch = Number(parsed.epoch);
    if (!ownerAccountId || ownerAccountId !== accountId || !Number.isFinite(epoch)) return null;
    return {
      id: String(parsed.id),
      title: String(parsed.title ?? ""),
      joinUrl: String(parsed.joinUrl),
      ownerAccountId,
      expectedUid: parsed.expectedUid ? String(parsed.expectedUid) : undefined,
      expectedLogin: parsed.expectedLogin ? String(parsed.expectedLogin) : undefined,
      epoch,
    };
  } catch {
    return null;
  }
}

export function writePendingJoin(accountId: string, pending: PendingJoin): void {
  sessionStorage.setItem(pendingJoinStorageKey(accountId), JSON.stringify(pending));
}

export function clearPendingJoin(accountId: string): void {
  sessionStorage.removeItem(pendingJoinStorageKey(accountId));
}

export function telemostAuthCheckUrl(joinUrl: string): string {
  const parsed = new URL(joinUrl);
  if (!/^telemost(?:\.360)?\.yandex\.ru$/i.test(parsed.hostname)) {
    throw new Error("Only a Telemost meeting join URL can be prepared.");
  }
  return `https://${parsed.hostname}/?${TELEMOST_AUTH_CHECK_PARAM}=1`;
}

export function isTelemostAuthCheckUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && /^telemost(?:\.360)?\.yandex\.ru$/i.test(parsed.hostname)
      && (parsed.pathname === "/" || parsed.pathname === "")
      && parsed.searchParams.get(TELEMOST_AUTH_CHECK_PARAM) === "1";
  } catch {
    return false;
  }
}

export function parseTelemostAuthBeacon(payload: string): TelemostAuthBeacon {
  const raw = payload.replace(/^__O360_TELEMOST_CREATE__:/, "").trim();
  const body = raw.startsWith("auth=") ? raw.slice(5) : raw;
  const parts = body.split(";").map((part) => part.trim()).filter(Boolean);
  const stateToken = parts[0] ?? "";
  const fields = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const split = part.indexOf("=");
    if (split <= 0) continue;
    fields.set(part.slice(0, split), part.slice(split + 1));
  }
  const state = stateToken === "CHECKING" || stateToken === "AUTHENTICATED"
    || stateToken === "REQUIRED" || stateToken === "TIMEOUT"
    ? stateToken
    : "UNKNOWN";
  const surfaceRaw = fields.get("surface");
  const surface: TelemostAuthSurface = surfaceRaw === "create" || surfaceRaw === "check" || surfaceRaw === "join"
    ? surfaceRaw
    : "unknown";
  return {
    state,
    uid: (fields.get("uid") ?? "").trim(),
    login: (fields.get("login") ?? "").trim(),
    surface,
  };
}

export function passportIdentityMatches(
  expectedEmail: string | null | undefined,
  login: string,
): PassportMatch {
  const expected = expectedEmail?.includes("@") ? normalizeEmail(expectedEmail) : "";
  const actual = login.trim().toLowerCase();
  if (!expected || !actual) return "unknown";
  if (actual === expected) return "match";
  const expectedLocal = expected.slice(0, expected.indexOf("@"));
  if (!actual.includes("@")) {
    return actual === expectedLocal ? "match" : "mismatch";
  }
  return actual === expected ? "match" : "mismatch";
}

export function shouldOpenJoinAfterAuthCheck(beacon: TelemostAuthBeacon): boolean {
  return beacon.surface === "check" && beacon.state === "AUTHENTICATED";
}

export type PassportIdentityDecision = "match" | "mismatch" | "unavailable";

export function decidePassportIdentity(input: {
  expectedUid?: string | null;
  expectedEmail?: string | null;
  beaconUid: string;
  beaconLogin: string;
}): PassportIdentityDecision {
  const expectedUid = input.expectedUid?.trim() ?? "";
  const beaconUid = input.beaconUid.trim();
  if (expectedUid) {
    if (!beaconUid) return "unavailable";
    return beaconUid === expectedUid ? "match" : "mismatch";
  }
  const loginMatch = passportIdentityMatches(input.expectedEmail, input.beaconLogin);
  if (loginMatch === "match") return "match";
  if (loginMatch === "mismatch") return "mismatch";
  return "unavailable";
}

export function shouldBootstrapAfterAuthCheck(beacon: TelemostAuthBeacon): boolean {
  return beacon.surface === "check" && beacon.state === "REQUIRED";
}

export function shouldFailClosedAfterAuthCheck(beacon: TelemostAuthBeacon): boolean {
  return beacon.surface === "check" && beacon.state === "TIMEOUT";
}

export function shouldIgnoreJoinAuthRequired(beacon: TelemostAuthBeacon): boolean {
  return beacon.surface === "join";
}

export type AuthenticatedJoinDecision = "resume" | "ignore" | "mismatch" | "auth_required";
export type AuthenticatedIdentityDecision = "resume_join" | "create_ready" | "ignore" | "mismatch" | "auth_required";

export function decideAuthenticatedIdentity(input: {
  beacon: TelemostAuthBeacon;
  pendingJoinUrl: string | null;
  alreadyResumedJoinUrl: string | null;
  expectedEmail?: string | null;
  expectedUid?: string | null;
}): AuthenticatedIdentityDecision {
  if (shouldIgnoreJoinAuthRequired(input.beacon)) return "ignore";
  if (input.beacon.state !== "AUTHENTICATED") return "ignore";
  const identity = decidePassportIdentity({
    expectedUid: input.expectedUid,
    expectedEmail: input.expectedEmail,
    beaconUid: input.beacon.uid,
    beaconLogin: input.beacon.login,
  });
  if (identity === "mismatch") return "mismatch";
  if (identity === "unavailable") return "auth_required";
  if (shouldOpenJoinAfterAuthCheck(input.beacon)) {
    if (!input.pendingJoinUrl) return "ignore";
    if (input.alreadyResumedJoinUrl === input.pendingJoinUrl) return "ignore";
    return "resume_join";
  }
  if (input.beacon.surface === "create") return "create_ready";
  return "ignore";
}

export function shouldResumeAuthenticatedJoin(input: {
  beacon: TelemostAuthBeacon;
  pendingJoinUrl: string | null;
  alreadyResumedJoinUrl: string | null;
  expectedEmail?: string | null;
}): AuthenticatedJoinDecision {
  const decision = decideAuthenticatedIdentity(input);
  if (decision === "resume_join") return "resume";
  if (decision === "mismatch") return "mismatch";
  if (decision === "auth_required") return "auth_required";
  return "ignore";
}

export type DirectJoinAuthLogState =
  | "CHECKING"
  | "REQUIRED"
  | "BOOTSTRAP_START"
  | "BOOTSTRAP_COMPLETE"
  | "RECHECK"
  | "AUTHENTICATED"
  | "AUTH_CACHE_HIT"
  | "OPEN_JOIN"
  | "ACCOUNT_MISMATCH"
  | "ACCOUNT_OWNER_MISMATCH"
  | "WEB_CREATE_SUPPRESSED"
  | "FAIL_CLOSED"
  | "RETRY_REUSE";

export const DIRECT_JOIN_AUTH_REQUIRED_MESSAGE =
  "Для входа во встречу через ваш Яндекс ID требуется авторизация.";

export type DirectJoinAuthRequiredAction = "bootstrap" | "web_create_bootstrap" | "fail_closed" | "ignore";

export function logDirectJoinAuth(state: DirectJoinAuthLogState): void {
  console.info(`[direct-join-auth] state=${state}`);
}

export function decideAuthRequiredAction(input: {
  beacon: TelemostAuthBeacon;
  pageMode: string;
  hasPendingJoin: boolean;
  bootstrapInFlight: boolean;
  recheckAfterBootstrap: boolean;
}): DirectJoinAuthRequiredAction {
  if (shouldIgnoreJoinAuthRequired(input.beacon)) return "ignore";
  if (input.beacon.surface === "create" && input.hasPendingJoin) return "ignore";

  const directJoin = input.pageMode === "PREPARE_JOIN"
    || input.hasPendingJoin
    || input.beacon.surface === "check";

  if (directJoin) {
    if (input.bootstrapInFlight) return "ignore";
    if (shouldFailClosedAfterAuthCheck(input.beacon)) return "fail_closed";
    if (input.recheckAfterBootstrap && (input.beacon.state === "REQUIRED" || input.beacon.state === "TIMEOUT")) {
      return "fail_closed";
    }
    if (input.beacon.state === "REQUIRED" || input.beacon.state === "UNKNOWN") {
      return "bootstrap";
    }
    return "ignore";
  }

  if (input.pageMode === "CREATE_WEB") {
    if (input.bootstrapInFlight) return "ignore";
    if (input.beacon.state === "TIMEOUT") return "fail_closed";
    return "web_create_bootstrap";
  }
  return "ignore";
}

export type TelemostCapabilityGate = "UNKNOWN" | "API_AVAILABLE" | "WEB_ONLY";

const API_DIRECT_PHASES: ReadonlySet<DirectJoinPhase> = new Set([
  "join_url_ready",
  "wk_auth_check",
  "passport_bootstrap",
  "auth_ready",
  "open_join",
]);

export function isTelemostWebCreateUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && /^telemost(?:\.360)?\.yandex\.ru$/i.test(parsed.hostname)
      && (parsed.pathname === "/" || parsed.pathname === "")
      && parsed.searchParams.get("browser-auto-create") === "1";
  } catch {
    return false;
  }
}

export function isApiDirectJoinPhase(phase: DirectJoinPhase): boolean {
  return API_DIRECT_PHASES.has(phase);
}

export function shouldIgnoreDuplicateCreateClick(phase: DirectJoinPhase): boolean {
  return phase === "join_url_ready"
    || phase === "wk_auth_check"
    || phase === "passport_bootstrap"
    || phase === "auth_ready"
    || phase === "open_join";
}

export function shouldAllowWebCreate(input: {
  capability: TelemostCapabilityGate;
  pendingJoinUrl: string | null;
  directJoinPhase: DirectJoinPhase;
  alreadyOpenedJoinUrl: string | null;
}): boolean {
  if (input.pendingJoinUrl || input.alreadyOpenedJoinUrl) return false;
  if (isApiDirectJoinPhase(input.directJoinPhase)) return false;
  return input.capability === "WEB_ONLY";
}

export function decideCreateAccountOwner(
  ownerAccountId: string | null | undefined,
  wkAccountId: string | null | undefined,
): "ok" | "mismatch" {
  if (!ownerAccountId || !wkAccountId) return "mismatch";
  return ownerAccountId === wkAccountId ? "ok" : "mismatch";
}

export function shouldOpenMacosEmbeddedUrl(url: string, input: {
  capability: TelemostCapabilityGate;
  pendingJoinUrl: string | null;
  directJoinPhase: DirectJoinPhase;
  alreadyOpenedJoinUrl: string | null;
}): boolean {
  if (/^https:\/\/telemost(?:\.360)?\.yandex\.ru\/j\/[^/?#]+/i.test(url)) return true;
  if (isTelemostAuthCheckUrl(url)) {
    return Boolean(input.pendingJoinUrl)
      || input.directJoinPhase === "wk_auth_check"
      || input.directJoinPhase === "passport_bootstrap"
      || input.directJoinPhase === "join_url_ready";
  }
  if (isTelemostWebCreateUrl(url)) {
    return shouldAllowWebCreate(input) && input.directJoinPhase === "idle";
  }
  return false;
}

export function normalizeCapturedJoinUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !/^telemost(?:\.360)?\.yandex\.ru$/i.test(parsed.hostname)) return null;
    const id = parsed.pathname.match(/^\/j\/(\d+)/)?.[1];
    if (!id) return null;
    const host = parsed.hostname.replace(/^telemost\.360\.yandex\.ru$/i, "telemost.yandex.ru");
    return `https://${host}/j/${id}`;
  } catch {
    return null;
  }
}

export type WebOnlyFailClosedRetry = "retry_existing" | "retry_new_web_create";

export function decideWebOnlyFailClosedRetry(capturedJoinUrl: string | null | undefined): WebOnlyFailClosedRetry {
  return capturedJoinUrl && normalizeCapturedJoinUrl(capturedJoinUrl) ? "retry_existing" : "retry_new_web_create";
}

export function shouldReuseCurrentJoinSurface(
  currentWkUrl: string | null | undefined,
  capturedJoinUrl: string,
): boolean {
  const captured = normalizeCapturedJoinUrl(capturedJoinUrl);
  const current = currentWkUrl ? normalizeCapturedJoinUrl(currentWkUrl) : null;
  return Boolean(captured && current && captured === current);
}

export function shouldPermitCreateWebOverlay(input: {
  directJoinPhase: DirectJoinPhase;
  nativeCreateWillOpen: boolean;
}): boolean {
  return input.nativeCreateWillOpen && input.directJoinPhase === "idle";
}

export const AUTH_CHECK_WATCHDOG_MS = 8_000;
export const VERIFIED_BROWSER_AUTH_TTL_MS = 90_000;

export type VerifiedBrowserAuth = {
  accountId: string;
  uid: string;
  login: string;
  at: number;
};

let verifiedBrowserAuth: VerifiedBrowserAuth | null = null;

export function rememberVerifiedBrowserAuth(
  accountId: string,
  uid: string,
  login = "",
  now = Date.now(),
): void {
  if (!accountId) return;
  verifiedBrowserAuth = { accountId, uid, login, at: now };
}

export function invalidateVerifiedBrowserAuthForAccount(accountId: string): void {
  if (verifiedBrowserAuth?.accountId === accountId) verifiedBrowserAuth = null;
}

export function invalidateVerifiedBrowserAuth(): void {
  verifiedBrowserAuth = null;
}

export function readVerifiedBrowserAuth(
  accountId: string,
  now = Date.now(),
): VerifiedBrowserAuth | null {
  if (!verifiedBrowserAuth || verifiedBrowserAuth.accountId !== accountId) return null;
  if (now - verifiedBrowserAuth.at > VERIFIED_BROWSER_AUTH_TTL_MS) {
    verifiedBrowserAuth = null;
    return null;
  }
  return verifiedBrowserAuth;
}

export function shouldSkipAuthCheck(accountId: string, now = Date.now()): boolean {
  return readVerifiedBrowserAuth(accountId, now) !== null;
}

export function shouldRecheckAfterJoinAuthFailure(
  beacon: TelemostAuthBeacon,
  usedAuthCache: boolean,
): boolean {
  return usedAuthCache && beacon.surface === "join" && beacon.state === "REQUIRED";
}

export function logRetryReuse(conferenceId: string): void {
  console.info(`[direct-join-auth] RETRY_REUSE conference_id=${conferenceId}`);
}

export type DirectJoinTimingMark =
  | "CREATE_CLICK"
  | "API_REQUEST_START"
  | "API_RESPONSE"
  | "JOIN_URL_READY"
  | "AUTH_CHECK_OPEN"
  | "AUTH_CHECK_COMMIT"
  | "AUTHENTICATED"
  | "OPEN_JOIN"
  | "J_NAV_START"
  | "J_COMMIT"
  | "J_FINISH"
  | "STAGE3_READY"
  | "MASK_OFF";

let timingT0 = 0;
const timingMarks = new Map<DirectJoinTimingMark, number>();

export function startDirectJoinTiming(): void {
  timingT0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  timingMarks.clear();
  markDirectJoinTiming("CREATE_CLICK");
}

export function markDirectJoinTiming(mark: DirectJoinTimingMark): void {
  if (!timingT0) return;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const elapsed = Math.round(now - timingT0);
  if (!timingMarks.has(mark)) timingMarks.set(mark, elapsed);
  console.info(`[direct-join-timing] ${mark} +${elapsed}ms`);
}

export function directJoinTimingElapsed(mark: DirectJoinTimingMark): number {
  return timingMarks.get(mark) ?? -1;
}

export function reportDirectJoinTiming(conferenceId = ""): Record<string, number> {
  const delta = (later: DirectJoinTimingMark, earlier: DirectJoinTimingMark) => {
    const left = timingMarks.get(later);
    const right = timingMarks.get(earlier);
    return left != null && right != null ? left - right : -1;
  };
  const summary = {
    API: delta("API_RESPONSE", "API_REQUEST_START"),
    AUTH: delta("AUTHENTICATED", "AUTH_CHECK_OPEN"),
    HANDOFF: delta("J_NAV_START", "AUTHENTICATED"),
    "J_COMMIT": delta("J_COMMIT", "J_NAV_START"),
    "J_FINISH": delta("J_FINISH", "J_NAV_START"),
    READY: delta("STAGE3_READY", "J_COMMIT"),
    TOTAL: timingMarks.get("MASK_OFF") ?? timingMarks.get("STAGE3_READY") ?? -1,
  };
  console.info(
    `[direct-join-timing] summary conference_id=${conferenceId}`
    + ` API=${summary.API} AUTH=${summary.AUTH} J_COMMIT=${summary["J_COMMIT"]}`
    + ` J_FINISH=${summary["J_FINISH"]} READY=${summary.READY} TOTAL=${summary.TOTAL}`,
  );
  return summary;
}
