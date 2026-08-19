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
  decidePassportIdentity,
  shouldAllowWebCreate,
  shouldOpenMacosEmbeddedUrl,
  shouldPermitCreateWebOverlay,
  shouldIgnoreDuplicateCreateClick,
  decideCreateAccountOwner,
  isTelemostWebCreateUrl,
  rememberVerifiedBrowserAuth,
  invalidateVerifiedBrowserAuth,
  shouldSkipAuthCheck,
  shouldRecheckAfterJoinAuthFailure,
  decideWebOnlyFailClosedRetry,
  normalizeCapturedJoinUrl,
  shouldReuseCurrentJoinSurface,
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
    writePendingJoin("acc-1", {
      id: "new-1",
      title: "Новая встреча",
      joinUrl: "https://telemost.360.yandex.ru/j/7110455263",
      ownerAccountId: "acc-1",
      epoch: 1,
    });
    expect(readPendingJoin("acc-1")).toEqual({
      id: "new-1",
      title: "Новая встреча",
      joinUrl: "https://telemost.360.yandex.ru/j/7110455263",
      ownerAccountId: "acc-1",
      epoch: 1,
    });
    clearPendingJoin("acc-1");
    expect(readPendingJoin("acc-1")).toBeNull();
  });

  it("rejects a pending join without owner or epoch", () => {
    sessionStorage.setItem("office360_telemost_pending_join:acc-1", JSON.stringify({
      id: "new-1",
      title: "Новая встреча",
      joinUrl: "https://telemost.360.yandex.ru/j/7110455263",
    }));
    expect(readPendingJoin("acc-1")).toBeNull();
    sessionStorage.setItem("office360_telemost_pending_join:acc-1", JSON.stringify({
      id: "new-1",
      title: "Новая встреча",
      joinUrl: "https://telemost.360.yandex.ru/j/7110455263",
      ownerAccountId: "acc-2",
      epoch: 1,
    }));
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
    expect(decidePassportIdentity({
      expectedEmail: "korotkov.g@office-360.ru",
      beaconUid: "1",
      beaconLogin: "",
    })).toBe("unavailable");
    expect(decidePassportIdentity({
      expectedUid: "1130000072185511",
      beaconUid: "1130000072185511",
      beaconLogin: "",
    })).toBe("match");
    expect(decidePassportIdentity({
      expectedUid: "111",
      expectedEmail: "korotkov.g@office-360.ru",
      beaconUid: "222",
      beaconLogin: "korotkov.g@office-360.ru",
    })).toBe("mismatch");
  });

  it("fails closed when AUTHENTICATED cannot be positively matched", () => {
    const joinUrl = "https://telemost.360.yandex.ru/j/7110455263";
    expect(decideAuthenticatedIdentity({
      beacon: parseTelemostAuthBeacon("auth=AUTHENTICATED;uid=1;login=;surface=check"),
      pendingJoinUrl: joinUrl,
      alreadyResumedJoinUrl: null,
      expectedEmail: "korotkov.g@office-360.ru",
    })).toBe("auth_required");
    expect(decideAuthenticatedIdentity({
      beacon: parseTelemostAuthBeacon("auth=AUTHENTICATED;uid=99;login=other@yandex.ru;surface=check"),
      pendingJoinUrl: joinUrl,
      alreadyResumedJoinUrl: null,
      expectedEmail: "korotkov.g@office-360.ru",
    })).toBe("mismatch");
    expect(decideAuthenticatedIdentity({
      beacon: parseTelemostAuthBeacon("auth=AUTHENTICATED;uid=1;login=;surface=check"),
      pendingJoinUrl: joinUrl,
      alreadyResumedJoinUrl: null,
    })).toBe("auth_required");
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

  it("treats captured /j/ with browser-auto-create query as a meeting URL", () => {
    const captured = "https://telemost.yandex.ru/j/98543805636845?browser-auto-create=1";
    const webIdle = {
      capability: "WEB_ONLY" as const,
      pendingJoinUrl: null as string | null,
      directJoinPhase: "idle" as const,
      alreadyOpenedJoinUrl: null as string | null,
    };
    expect(shouldOpenMacosEmbeddedUrl(captured, webIdle)).toBe(true);
    expect(isTelemostWebCreateUrl(captured)).toBe(false);
    expect(isTelemostWebCreateUrl("https://telemost.yandex.ru/?browser-auto-create=1")).toBe(true);
    expect(shouldAllowWebCreate(webIdle)).toBe(true);
    expect(shouldAllowWebCreate({ ...webIdle, pendingJoinUrl: captured })).toBe(false);
    expect(decideAuthRequiredAction({
      beacon: parseTelemostAuthBeacon("auth=REQUIRED;surface=join"),
      pageMode: "MEETING_PREPARING",
      hasPendingJoin: false,
      bootstrapInFlight: false,
      recheckAfterBootstrap: false,
    })).toBe("ignore");
    expect(normalizeCapturedJoinUrl(captured)).toBe("https://telemost.yandex.ru/j/98543805636845");
    expect(shouldReuseCurrentJoinSurface("https://telemost.yandex.ru/", captured)).toBe(false);
    expect(shouldReuseCurrentJoinSurface(captured, captured)).toBe(true);
    expect(shouldReuseCurrentJoinSurface(null, captured)).toBe(false);
  });

  it("splits fail_closed retry into reuse captured /j/ vs a legal WEB CREATE restart", () => {
    const captured = "https://telemost.yandex.ru/j/40669270118884?browser-auto-create=1";
    expect(decideWebOnlyFailClosedRetry(captured)).toBe("retry_existing");
    expect(decideWebOnlyFailClosedRetry(null)).toBe("retry_new_web_create");
    expect(shouldOpenMacosEmbeddedUrl("https://telemost.yandex.ru/?browser-auto-create=1", {
      capability: "WEB_ONLY",
      pendingJoinUrl: null,
      directJoinPhase: "fail_closed",
      alreadyOpenedJoinUrl: null,
    })).toBe(false);
    expect(shouldPermitCreateWebOverlay({
      directJoinPhase: "fail_closed",
      nativeCreateWillOpen: false,
    })).toBe(false);
    expect(shouldPermitCreateWebOverlay({
      directJoinPhase: "idle",
      nativeCreateWillOpen: true,
    })).toBe(true);
    expect(shouldOpenMacosEmbeddedUrl("https://telemost.yandex.ru/?browser-auto-create=1", {
      capability: "WEB_ONLY",
      pendingJoinUrl: null,
      directJoinPhase: "idle",
      alreadyOpenedJoinUrl: null,
    })).toBe(true);
    expect(shouldOpenMacosEmbeddedUrl("https://telemost.yandex.ru/j/40669270118884", {
      capability: "WEB_ONLY",
      pendingJoinUrl: null,
      directJoinPhase: "fail_closed",
      alreadyOpenedJoinUrl: null,
    })).toBe(true);
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
