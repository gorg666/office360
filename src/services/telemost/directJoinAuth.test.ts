import {
  clearPendingJoin,
  decideAuthRequiredAction,
  isTelemostAuthCheckUrl,
  parseTelemostAuthBeacon,
  passportIdentityMatches,
  readPendingJoin,
  shouldBootstrapAfterAuthCheck,
  shouldFailClosedAfterAuthCheck,
  shouldIgnoreJoinAuthRequired,
  shouldOpenJoinAfterAuthCheck,
  decideAuthenticatedIdentity,
  shouldResumeAuthenticatedJoin,
  telemostAuthCheckUrl,
  writePendingJoin,
  shouldAllowWebCreate,
  shouldOpenMacosEmbeddedUrl,
  shouldIgnoreDuplicateCreateClick,
  decideCreateAccountOwner,
  rememberVerifiedBrowserAuth,
  invalidateVerifiedBrowserAuth,
  shouldSkipAuthCheck,
  shouldRecheckAfterJoinAuthFailure,
  VERIFIED_BROWSER_AUTH_TTL_MS,
} from "./directJoinAuth";

describe("directJoinAuth", () => {
  beforeEach(() => {
    sessionStorage.clear();
    invalidateVerifiedBrowserAuth();
  });

  it("builds a hidden auth-check URL on the same join host", () => {
    expect(telemostAuthCheckUrl("https://telemost.360.yandex.ru/j/7110455263")).toBe(
      "https://telemost.360.yandex.ru/?office360-auth-check=1",
    );
    expect(isTelemostAuthCheckUrl("https://telemost.360.yandex.ru/?office360-auth-check=1")).toBe(true);
    expect(isTelemostAuthCheckUrl("https://telemost.yandex.ru/?browser-auto-create=1")).toBe(false);
  });

  it("preserves and clears the pending join URL", () => {
    writePendingJoin("acc-1", { id: "new-1", title: "Новая встреча", joinUrl: "https://telemost.360.yandex.ru/j/7110455263" });
    expect(readPendingJoin("acc-1")).toEqual({
      id: "new-1",
      title: "Новая встреча",
      joinUrl: "https://telemost.360.yandex.ru/j/7110455263",
    });
    clearPendingJoin("acc-1");
    expect(readPendingJoin("acc-1")).toBeNull();
  });

  it("opens /j/ only after an authenticated auth-check beacon", () => {
    const ready = parseTelemostAuthBeacon("auth=AUTHENTICATED;uid=123;login=korotkov.g@office-360.ru;surface=check");
    expect(shouldOpenJoinAfterAuthCheck(ready)).toBe(true);
    expect(shouldBootstrapAfterAuthCheck(parseTelemostAuthBeacon("auth=REQUIRED;surface=check"))).toBe(true);
    expect(shouldBootstrapAfterAuthCheck(parseTelemostAuthBeacon("auth=TIMEOUT;surface=check"))).toBe(false);
    expect(shouldFailClosedAfterAuthCheck(parseTelemostAuthBeacon("auth=TIMEOUT;surface=check"))).toBe(true);
    expect(shouldOpenJoinAfterAuthCheck(parseTelemostAuthBeacon("auth=AUTHENTICATED;uid=123;surface=create"))).toBe(false);
    expect(shouldIgnoreJoinAuthRequired(parseTelemostAuthBeacon("auth=REQUIRED;surface=join"))).toBe(true);
  });

  it("resumes a pending join once for duplicate AUTHENTICATED beacons", () => {
    const ready = parseTelemostAuthBeacon("auth=AUTHENTICATED;uid=123;login=korotkov.g@office-360.ru;surface=check");
    const joinUrl = "https://telemost.360.yandex.ru/j/7110455263";
    expect(shouldResumeAuthenticatedJoin({
      beacon: ready,
      pendingJoinUrl: joinUrl,
      alreadyResumedJoinUrl: null,
      expectedEmail: "korotkov.g@office-360.ru",
    })).toBe("resume");
    expect(shouldResumeAuthenticatedJoin({
      beacon: ready,
      pendingJoinUrl: joinUrl,
      alreadyResumedJoinUrl: joinUrl,
      expectedEmail: "korotkov.g@office-360.ru",
    })).toBe("ignore");
    expect(shouldResumeAuthenticatedJoin({
      beacon: ready,
      pendingJoinUrl: null,
      alreadyResumedJoinUrl: null,
      expectedEmail: "korotkov.g@office-360.ru",
    })).toBe("ignore");
    expect(shouldResumeAuthenticatedJoin({
      beacon: ready,
      pendingJoinUrl: joinUrl,
      alreadyResumedJoinUrl: null,
      expectedEmail: "other@yandex.ru",
    })).toBe("mismatch");
    expect(shouldResumeAuthenticatedJoin({
      beacon: parseTelemostAuthBeacon("auth=AUTHENTICATED;uid=1;surface=join"),
      pendingJoinUrl: joinUrl,
      alreadyResumedJoinUrl: null,
    })).toBe("ignore");
    expect(decideAuthenticatedIdentity({
      beacon: parseTelemostAuthBeacon("auth=AUTHENTICATED;uid=1130000072185511;login=korotkov.g@office-360.ru;surface=create"),
      pendingJoinUrl: null,
      alreadyResumedJoinUrl: null,
      expectedEmail: "korotkov.g@office-360.ru",
    })).toBe("create_ready");
    expect(decideAuthenticatedIdentity({
      beacon: parseTelemostAuthBeacon("auth=AUTHENTICATED;uid=1;login=other@yandex.ru;surface=create"),
      pendingJoinUrl: null,
      alreadyResumedJoinUrl: null,
      expectedEmail: "korotkov.g@office-360.ru",
    })).toBe("mismatch");
  });

  it("starts one Passport bootstrap for REQUIRED auth-check", () => {
    const required = parseTelemostAuthBeacon("auth=REQUIRED;surface=check");
    expect(decideAuthRequiredAction({
      beacon: required,
      pageMode: "PREPARE_JOIN",
      hasPendingJoin: true,
      bootstrapInFlight: false,
      recheckAfterBootstrap: false,
    })).toBe("bootstrap");
    expect(decideAuthRequiredAction({
      beacon: required,
      pageMode: "PREPARE_JOIN",
      hasPendingJoin: true,
      bootstrapInFlight: true,
      recheckAfterBootstrap: false,
    })).toBe("ignore");
    expect(decideAuthRequiredAction({
      beacon: required,
      pageMode: "PREPARE_JOIN",
      hasPendingJoin: true,
      bootstrapInFlight: false,
      recheckAfterBootstrap: true,
    })).toBe("fail_closed");
    expect(decideAuthRequiredAction({
      beacon: parseTelemostAuthBeacon("auth=TIMEOUT;surface=check"),
      pageMode: "PREPARE_JOIN",
      hasPendingJoin: true,
      bootstrapInFlight: false,
      recheckAfterBootstrap: false,
    })).toBe("fail_closed");
    expect(decideAuthRequiredAction({
      beacon: parseTelemostAuthBeacon("auth=REQUIRED;surface=join"),
      pageMode: "MEETING",
      hasPendingJoin: false,
      bootstrapInFlight: false,
      recheckAfterBootstrap: false,
    })).toBe("ignore");
    expect(decideAuthRequiredAction({
      beacon: parseTelemostAuthBeacon("auth=REQUIRED;surface=create"),
      pageMode: "CREATE_WEB",
      hasPendingJoin: false,
      bootstrapInFlight: false,
      recheckAfterBootstrap: false,
    })).toBe("web_create_bootstrap");
    expect(decideAuthRequiredAction({
      beacon: parseTelemostAuthBeacon("auth=TIMEOUT;surface=create"),
      pageMode: "CREATE_WEB",
      hasPendingJoin: false,
      bootstrapInFlight: false,
      recheckAfterBootstrap: false,
    })).toBe("fail_closed");
  });

  it("matches Passport login to the Office360 mailbox when verifiable", () => {
    expect(passportIdentityMatches("korotkov.g@office-360.ru", "korotkov.g@office-360.ru")).toBe("match");
    expect(passportIdentityMatches("korotkov.g@office-360.ru", "korotkov.g")).toBe("match");
    expect(passportIdentityMatches("korotkov.g@office-360.ru", "other@yandex.ru")).toBe("mismatch");
    expect(passportIdentityMatches("korotkov.g@office-360.ru", "")).toBe("unknown");
  });

  it("allows WEB CREATE only when API CREATE is unavailable and no pending join owns the surface", () => {
    const idle = {
      pendingJoinUrl: null as string | null,
      directJoinPhase: "idle" as const,
      alreadyOpenedJoinUrl: null as string | null,
    };
    expect(shouldAllowWebCreate({ capability: "API_AVAILABLE", ...idle })).toBe(false);
    expect(shouldAllowWebCreate({ capability: "UNKNOWN", ...idle })).toBe(false);
    expect(shouldAllowWebCreate({ capability: "WEB_ONLY", ...idle })).toBe(true);
    expect(shouldAllowWebCreate({
      capability: "WEB_ONLY",
      pendingJoinUrl: "https://telemost.360.yandex.ru/j/3320691266",
      directJoinPhase: "idle",
      alreadyOpenedJoinUrl: null,
    })).toBe(false);
    expect(shouldAllowWebCreate({
      capability: "WEB_ONLY",
      pendingJoinUrl: null,
      directJoinPhase: "open_join",
      alreadyOpenedJoinUrl: "https://telemost.360.yandex.ru/j/3320691266",
    })).toBe(false);
  });

  it("never opens browser-auto-create HOME after API CREATE owns the flow", () => {
    const joinUrl = "https://telemost.360.yandex.ru/j/3320691266";
    const createUrl = "https://telemost.yandex.ru/?browser-auto-create=1";
    const authCheck = "https://telemost.360.yandex.ru/?office360-auth-check=1";
    const apiFlow = {
      capability: "API_AVAILABLE" as const,
      pendingJoinUrl: joinUrl,
      directJoinPhase: "wk_auth_check" as const,
      alreadyOpenedJoinUrl: null as string | null,
    };
    expect(shouldOpenMacosEmbeddedUrl(joinUrl, apiFlow)).toBe(true);
    expect(shouldOpenMacosEmbeddedUrl(authCheck, apiFlow)).toBe(true);
    expect(shouldOpenMacosEmbeddedUrl(createUrl, apiFlow)).toBe(false);
    expect(shouldOpenMacosEmbeddedUrl(createUrl, {
      ...apiFlow,
      directJoinPhase: "open_join",
      alreadyOpenedJoinUrl: joinUrl,
    })).toBe(false);
    expect(shouldOpenMacosEmbeddedUrl(authCheck, {
      capability: "API_AVAILABLE",
      pendingJoinUrl: null,
      directJoinPhase: "open_join",
      alreadyOpenedJoinUrl: joinUrl,
    })).toBe(false);
    expect(shouldOpenMacosEmbeddedUrl(createUrl, {
      capability: "WEB_ONLY",
      pendingJoinUrl: null,
      directJoinPhase: "idle",
      alreadyOpenedJoinUrl: null,
    })).toBe(true);
    expect(shouldIgnoreDuplicateCreateClick("wk_auth_check")).toBe(true);
    expect(shouldIgnoreDuplicateCreateClick("open_join")).toBe(true);
    expect(decideCreateAccountOwner("df5c12c9", "df5c12c9")).toBe("ok");
    expect(decideCreateAccountOwner("df5c12c9", "6f9630dd")).toBe("mismatch");
  });

  it("ignores stale WEB CREATE auth beacons while a pending join owns the surface", () => {
    expect(decideAuthRequiredAction({
      beacon: parseTelemostAuthBeacon("auth=REQUIRED;surface=create"),
      pageMode: "PREPARE_JOIN",
      hasPendingJoin: true,
      bootstrapInFlight: false,
      recheckAfterBootstrap: false,
    })).toBe("ignore");
    expect(decideAuthRequiredAction({
      beacon: parseTelemostAuthBeacon("auth=TIMEOUT;surface=create"),
      pageMode: "MEETING",
      hasPendingJoin: true,
      bootstrapInFlight: false,
      recheckAfterBootstrap: false,
    })).toBe("ignore");
  });

  it("caches a short-lived verified browser auth for the same account", () => {
    expect(shouldSkipAuthCheck("acc-1", 1_000)).toBe(false);
    rememberVerifiedBrowserAuth("acc-1", "42", "person@example.test", 1_000);
    expect(shouldSkipAuthCheck("acc-1", 1_000)).toBe(true);
    expect(shouldSkipAuthCheck("acc-1", 1_000 + VERIFIED_BROWSER_AUTH_TTL_MS - 1)).toBe(true);
    expect(shouldSkipAuthCheck("acc-2", 1_001)).toBe(false);
    expect(shouldSkipAuthCheck("acc-1", 1_000 + VERIFIED_BROWSER_AUTH_TTL_MS + 1)).toBe(false);
  });

  it("invalidates verified browser auth on account switch and Passport REQUIRED", () => {
    rememberVerifiedBrowserAuth("acc-1", "42", "person@example.test", 1_000);
    expect(shouldSkipAuthCheck("acc-1", 1_000)).toBe(true);
    invalidateVerifiedBrowserAuth();
    expect(shouldSkipAuthCheck("acc-1", 1_001)).toBe(false);
    rememberVerifiedBrowserAuth("acc-1", "42", "person@example.test", 2_000);
    expect(shouldRecheckAfterJoinAuthFailure(
      parseTelemostAuthBeacon("auth=REQUIRED;surface=join"),
      true,
    )).toBe(true);
    expect(shouldRecheckAfterJoinAuthFailure(
      parseTelemostAuthBeacon("auth=REQUIRED;surface=join"),
      false,
    )).toBe(false);
  });
});
