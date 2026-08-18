(() => {
  const telemostHost = () => /^(?:telemost\.yandex\.ru|telemost\.360\.yandex\.ru)$/.test(location.hostname);
  const passportHost = () => /^(?:sso\.passport|passport|oauth)\.yandex\.(?:ru|com)$/.test(location.hostname);
  const joinPath = () => /^\/j\/[^/?#]+/.test(location.pathname);
  const authCheckPath = () => /(?:^|[?&])office360-auth-check=1(?:&|$)/.test(location.search);
  const probeOnly = () => joinPath() || authCheckPath();
  const surfaceName = () => (joinPath() ? "join" : (authCheckPath() ? "check" : "create"));
  const pageEpoch = () => (telemostHost() && !joinPath() ? `${location.hostname}|${location.pathname}|${location.search}` : "");
  const USERS_ME = "/telemost_front/v2/telemost/users/me";

  if (passportHost() || !telemostHost()) return;
  // CREATE/auth automation is intentionally absent from meeting documents.
  // Direct joins are authenticated on the dedicated HOME auth-check document
  // before /j/ is opened; observing /j/ here can feed our title beacon back
  // into this script's own documentElement MutationObserver.
  if (joinPath()) {
    // One-shot cookie probe only. No observers, no CREATE click, no title loop.
    void fetch(USERS_ME, {
      credentials: "include",
      headers: { Accept: "application/json", "X-Application-Id": "telemost" },
    }).then((response) => {
      if (response.ok) return;
      try { document.title = "__O360_TELEMOST_CREATE__:auth=REQUIRED;surface=join"; } catch (_) {}
    }).catch(() => {});
    return;
  }

  const CREATE_CTA = /^\s*(создать видеовстречу|create video meeting)\s*$/i;
  const JOIN_CTA = /^\s*(присоединиться|продолжить|join)\s*$/i;
  const LEAVE_CTA = /^\s*(выйти|покинуть встречу|покинуть|leave)\s*$/i;
  const events = [];
  let clicked = false;
  let observer = null;
  let timeoutId = null;
  let stopped = false;
  let ambiguousLogged = false;
  let epoch = pageEpoch();
  let authState = "CHECKING";
  let authEpoch = "checking";
  let lastBeacon = "";
  let meInflight = null;
  let meSettled = false;
  let meUser = null;
  let identity = { uid: "", login: "" };

  const record = (name) => {
    events.push(name);
    console.info("[telemost-create] " + name);
    try {
      const previous = document.title;
      document.title = "__O360_TELEMOST_CREATE__:" + name;
      setTimeout(() => {
        if (String(document.title).indexOf("__O360_TELEMOST_CREATE__:") === 0) {
          document.title = previous;
        }
      }, 0);
    } catch (_) {}
  };

  const emitAuth = (state, extra) => {
    const surface = `surface=${surfaceName()}`;
    const detail = extra ? `${extra};${surface}` : surface;
    if (authState === state && lastBeacon === `${state}|${detail}`) return;
    authState = state;
    lastBeacon = `${state}|${detail}`;
    record(`auth=${state};${detail}`);
  };

  const uidOf = (user) => {
    if (!user || typeof user !== "object") return "";
    const uid = user.uid ?? user.id;
    if (uid == null || uid === false) return "";
    return String(uid).trim();
  };

  const loginOf = (user) => {
    if (!user || typeof user !== "object") return "";
    return String(user.login || user.email || "").trim();
  };

  const identityOf = (user) => ({ uid: uidOf(user), login: loginOf(user) });

  const readPreloadedUser = () => {
    const node = document.getElementById("preloaded-state");
    if (!node) return undefined;
    try {
      const parsed = JSON.parse(node.textContent || node.innerHTML || "null");
      return parsed && typeof parsed === "object" ? parsed.user : undefined;
    } catch (_) {
      return undefined;
    }
  };

  const currentUser = () => {
    const live = uidOf(meUser) ? meUser : null;
    if (live) return live;
    const preloaded = readPreloadedUser();
    if (preloaded && uidOf(preloaded)) return preloaded;
    return null;
  };

  const classify = () => {
    const user = currentUser();
    identity = identityOf(user);
    if (identity.uid) {
      authEpoch = `uid:${identity.uid}`;
      return "AUTHENTICATED";
    }
    if (!meSettled) {
      authEpoch = "checking";
      return "CHECKING";
    }
    authEpoch = "anonymous";
    return "REQUIRED";
  };

  const inDocument = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };

  const isActionable = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.disabled || element.getAttribute("aria-disabled") === "true") return false;
    if (element.inert) return false;
    if (!inDocument(element)) return false;
    if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
    return true;
  };

  const controlLabel = (element) => (
    element.innerText || element.textContent || element.getAttribute("aria-label") || ""
  ).replace(/\s+/g, " ").trim();

  const labeledControls = () => [...document.querySelectorAll("a,button,[role=button]")].filter(inDocument);

  const hasJoinOrLeave = () => labeledControls().some((element) => {
    const label = controlLabel(element);
    return JOIN_CTA.test(label) || LEAVE_CTA.test(label);
  });

  const findOfficialCreateCtas = () => labeledControls().filter((element) => CREATE_CTA.test(controlLabel(element)));

  const rememberMePayload = (payload) => {
    if (!payload || typeof payload !== "object") {
      meUser = null;
      return;
    }
    meUser = payload.user && typeof payload.user === "object" ? payload.user : payload;
  };

  const fetchMeUser = () => {
    if (meInflight) return meInflight;
    meInflight = Promise.resolve()
      .then(() => fetch(USERS_ME, {
        credentials: "include",
        headers: { Accept: "application/json", "X-Application-Id": "telemost" },
      }))
      .then(async (response) => {
        meSettled = true;
        meInflight = null;
        if (!response.ok) {
          meUser = null;
          return;
        }
        try {
          rememberMePayload(await response.json());
        } catch (_) {
          meUser = null;
        }
      })
      .catch(() => {
        meSettled = true;
        meInflight = null;
        meUser = null;
      })
      .then(() => { apply(); });
    return meInflight;
  };

  const installNetworkHooks = () => {
    if (window.__o360TelemostUsersMeHooked) return;
    window.__o360TelemostUsersMeHooked = true;
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = function patchedFetch(input, init) {
        const request = originalFetch.call(this, input, init);
        try {
          const url = String(typeof input === "string" ? input : (input && input.url) || "");
          if (url.indexOf("/telemost_front/v2/telemost/users/me") !== -1) {
            request.then(async (response) => {
              const clone = response.clone();
              meSettled = true;
              if (!clone.ok) {
                meUser = null;
                apply();
                return;
              }
              try {
                rememberMePayload(await clone.json());
              } catch (_) {
                meUser = null;
              }
              apply();
            }).catch(() => {});
          }
        } catch (_) {}
        return request;
      };
    }
  };

  const stopWatchers = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const stop = () => {
    stopped = true;
    stopWatchers();
  };

  const arm = () => {
    if (observer) return;
    observer = new MutationObserver(() => apply());
    const preload = document.getElementById("preloaded-state");
    if (preload) {
      observer.observe(preload, { childList: true, characterData: true, subtree: true });
    }
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "disabled", "aria-disabled", "inert", "aria-hidden"],
    });
    if (timeoutId === null && !probeOnly()) {
      timeoutId = setTimeout(() => {
        if (clicked || probeOnly()) return;
        meSettled = true;
        if (!uidOf(currentUser())) emitAuth("TIMEOUT");
        else record("timeout no CTA");
        apply();
      }, 12000);
    }
  };

  const syncEpoch = () => {
    const next = pageEpoch();
    if (!next || next === epoch) return;
    epoch = next;
    clicked = false;
    stopped = false;
    ambiguousLogged = false;
    meSettled = false;
    meUser = null;
    meInflight = null;
    authEpoch = "checking";
    stopWatchers();
    record("epoch reset");
    arm();
  };

  const clickCreate = () => {
    const matches = findOfficialCreateCtas().filter(isActionable);
    if (matches.length > 1) {
      if (!ambiguousLogged) {
        record("ambiguous CTA");
        ambiguousLogged = true;
      }
      return;
    }
    const cta = matches[0];
    if (!cta) return;
    record("official CTA matched");
    cta.click();
    clicked = true;
    record("clicked once");
    stopWatchers();
  };

  const apply = () => {
    if (passportHost() || !telemostHost()) return;
    if (joinPath()) return;
    if (!joinPath()) syncEpoch();
    if (stopped) return;
    // Auth-check must not wait for the marketing HOME SPA to reach complete.
    if (!authCheckPath() && document.readyState !== "complete") return;
    if (!probeOnly() && hasJoinOrLeave()) {
      record("skip PREJOIN/MEETING chrome");
      stop();
      return;
    }

    const previousAuthEpoch = authEpoch;
    const state = classify();
    if (state === "CHECKING") {
      emitAuth("CHECKING");
      fetchMeUser();
      return;
    }
    if (state === "REQUIRED") {
      clicked = false;
      if (authState !== "TIMEOUT") emitAuth("REQUIRED");
      return;
    }

    const extra = identity.login ? `uid=${identity.uid};login=${identity.login}` : `uid=${identity.uid}`;
    emitAuth("AUTHENTICATED", extra);
    if (previousAuthEpoch !== authEpoch) clicked = false;
    if (clicked || probeOnly()) return;
    clickCreate();
  };

  if (window.__o360TelemostOfficialCreate) {
    window.__o360TelemostOfficialCreate.kick();
    return;
  }

  installNetworkHooks();
  record(joinPath() ? "state=JOIN" : (authCheckPath() ? "state=AUTH_CHECK" : "state=HOME"));
  emitAuth("CHECKING");
  document.addEventListener("readystatechange", apply);
  const api = {
    events,
    get clicked() { return clicked ? 1 : 0; },
    get authState() { return authState; },
    get identity() { return identity; },
    stop,
    kick: () => {
      if (!uidOf(currentUser())) {
        meSettled = false;
        meUser = null;
        meInflight = null;
        stopped = false;
      }
      apply();
    },
  };
  window.__o360TelemostOfficialCreate = api;
  apply();
  if (authCheckPath()) {
    fetchMeUser();
  } else if (!stopped) {
    arm();
  }
})();
