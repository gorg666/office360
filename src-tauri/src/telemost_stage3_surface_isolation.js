(() => {
  const onTelemostHost = /^(?:telemost\.yandex\.ru|telemost\.360\.yandex\.ru)$/.test(location.hostname);
  const onPassport = /^(?:passport|oauth)\.yandex\.(?:ru|com)$/.test(location.hostname);
  if (onPassport || !onTelemostHost) return;
  if (window.__o360TelemostSurfaceIsolation) return;

  const HIDDEN = "o360-telemost-hidden";
  const STYLE_ID = "o360-telemost-stage3-isolation-style";
  const OBSERVER_MS = 12000;
  /** rAF is suspended while the native create mask occludes this webview. */
  const SCHEDULE_FALLBACK_MS = 200;
  const SIDEBAR = "[data-testid='orb-global-bar']";
  const DIALOG = "[role='dialog'],[role='alertdialog'],[aria-modal='true']";
  const protectedControl = /камера|микрофон|подключиться|участники|чат|реакц|демонстрац|поделиться|экран|настройки|выйти|завершить|join|camera|microphone|mic\b|participants|chat|reactions|share|settings|leave|end (the )?(call|meeting)/i;
  const joinControl = /^\s*(подключиться|join(?:\s+(?:the\s+)?(?:meeting|call))?)\s*$/i;
  const createControl = /создать видеовстречу|новая видеовстреча|create (a )?meeting/i;
  const leaveControl = /выйти из встречи|завершить встречу|leave (?:the )?meeting|end (?:the )?(?:call|meeting)/i;
  const meetingChrome = /участники|чат|реакц|демонстрац|поделиться экраном|participants|chat|reactions|share screen/i;
  const endedText = /встреча завершена|meeting (?:has )?ended|переподключиться|rejoin/i;
  const tariffText = /тарифы для бизнеса/i;
  const footerBits = [/поддержка/i, /частые вопросы/i, /скачать на macos/i, /скачать на mac/i, /скачать на телефон/i];
  const events = [];
  const seenJoin = typeof WeakSet === "function" ? new WeakSet() : null;
  let state = "UNKNOWN";
  let hiddenCount = 0;
  let lastApplyAt = 0;
  let lastCapture = null;
  let applyCount = 0;
  let observerCallbacks = 0;
  let scheduled = false;
  let observer = null;
  let timeoutId = null;
  let transitionPoll = null;
  let leavePoll = null;
  let meetingApplied = false;
  let historyHooked = false;
  let lastReadyBeacon = "";
  const PREJOIN_READY_TITLE = "__O360_TELEMOST_PREJOIN_READY__";
  const MEETING_READY_TITLE = "__O360_TELEMOST_MEETING_READY__";
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  const record = (name) => { events.push(name); };

  const emitVisualReady = (kind) => {
    if (lastReadyBeacon === kind) return;
    lastReadyBeacon = kind;
    const title = kind === "MEETING" ? MEETING_READY_TITLE : PREJOIN_READY_TITLE;
    record(`visual-ready ${kind}`);
    console.info(`[telemost-isolation] visual-ready=${kind}`);
    try {
      const previous = document.title;
      document.title = title;
      setTimeout(() => {
        if (String(document.title) === title) document.title = previous;
      }, 0);
    } catch (_) { /* ignore */ }
  };

  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && rect.width > 0
      && rect.height > 0
      && rect.bottom > 0
      && rect.right > 0
      && rect.left < innerWidth
      && rect.top < innerHeight;
  };

  const controlLabel = (element) => (
    element.getAttribute("aria-label") || element.innerText || element.textContent || ""
  ).replace(/\s+/g, " ").trim();

  const inGlobalBar = (element) => !!(element.closest?.(SIDEBAR));
  const inDialog = (element) => !!(element.closest?.(DIALOG));
  const rememberJoin = (element) => { if (seenJoin && element instanceof HTMLElement) seenJoin.add(element); };
  const isRememberedJoin = (element) => !!(seenJoin && element instanceof HTMLElement && seenJoin.has(element));

  const isAppRootish = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    if (element === document.body || element === document.documentElement) return true;
    if (element.id === "root" || element.id === "app") return true;
    const rect = element.getBoundingClientRect();
    return rect.width >= innerWidth * 0.85 && rect.height >= innerHeight * 0.75;
  };

  const coversMostViewport = (element) => {
    const rect = element.getBoundingClientRect();
    return (rect.width * rect.height) >= (innerWidth * innerHeight * 0.5);
  };

  const containsRememberedJoin = (element) => {
    if (!seenJoin) return false;
    return [...element.querySelectorAll("a,button,[role=button]")].some((node) => isRememberedJoin(node));
  };

  const containsProtectedSurface = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    if (element.matches?.("video,audio,canvas") || element.querySelector("video,audio,canvas")) return true;
    if (element.matches?.(DIALOG) || element.querySelector(DIALOG)) return true;
    if (isRememberedJoin(element) || containsRememberedJoin(element)) return true;
    return [...element.querySelectorAll("a,button,[role=button],[aria-label]")].some((node) => {
      if (!(node instanceof HTMLElement) || inGlobalBar(node)) return false;
      const label = controlLabel(node);
      if (joinControl.test(label)) rememberJoin(node);
      return protectedControl.test(label);
    });
  };

  const hide = (element) => {
    if (!(element instanceof HTMLElement) || element.classList.contains(HIDDEN)) return false;
    if (isAppRootish(element) || coversMostViewport(element)) return false;
    if (inDialog(element)) return false;
    if (element.matches?.("video,audio,canvas")) return false;
    if (containsProtectedSurface(element)) return false;
    element.classList.add(HIDDEN);
    return true;
  };

  const unhideAll = () => {
    for (const element of document.querySelectorAll(`.${HIDDEN}`)) {
      element.classList.remove(HIDDEN);
    }
    hiddenCount = 0;
  };

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `.${HIDDEN}{display:none!important}`;
    document.documentElement.appendChild(style);
  };

  const joinBusy = (element) => (
    element instanceof HTMLElement
    && (element.getAttribute("aria-busy") === "true" || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true")
  );

  const visibleMedia = () => [...document.querySelectorAll("video,canvas")].some((node) => visible(node));

  const labeledControls = () => [...document.querySelectorAll("a,button,[role=button],[aria-label]")]
    .filter((node) => node instanceof HTMLElement && visible(node) && !inGlobalBar(node));

  const detectState = () => {
    const path = location.pathname || "";
    if (!/^\/j\/[^/?#]+/.test(path)) return "HOME";
    const dialogs = [...document.querySelectorAll(DIALOG)];
    for (const dialog of dialogs) {
      if (!(dialog instanceof HTMLElement) || !visible(dialog)) continue;
      const text = (dialog.innerText || "").replace(/\s+/g, " ");
      if (/не удалось|произошла ошибка/i.test(text) && !joinControl.test(text)) return "ERROR";
    }
    const controls = labeledControls();
    let hasJoin = false;
    let hasBusyJoin = false;
    let hasLeave = false;
    let hasCreate = false;
    let chromeHits = 0;
    for (const node of controls) {
      const label = controlLabel(node);
      if (joinControl.test(label) || isRememberedJoin(node)) {
        rememberJoin(node);
        hasJoin = true;
        if (joinBusy(node)) hasBusyJoin = true;
      }
      if (createControl.test(label)) hasCreate = true;
      if (leaveControl.test(label)) hasLeave = true;
      if (meetingChrome.test(label)) chromeHits += 1;
    }
    const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ");
    const positiveMeeting = (hasLeave && !hasJoin) || (visibleMedia() && chromeHits >= 2 && !hasJoin);
    if (state === "TRANSITION") {
      if (positiveMeeting) return "MEETING";
      if (endedText.test(bodyText) && !hasJoin && !hasLeave) return "ENDED";
      return "TRANSITION";
    }
    if (hasCreate && !hasJoin && !hasLeave) return "HOME";
    if (positiveMeeting) return "MEETING";
    if (hasBusyJoin && (state === "PREJOIN" || state === "TRANSITION")) return "TRANSITION";
    if (hasJoin) return "PREJOIN";
    // Do not auto-TRANSITION when the join control briefly unmounts during SPA
    // remounts. TRANSITION is entered only from the JOIN click handler.
    if (state === "PREJOIN" || lastReadyBeacon === "PREJOIN") return "PREJOIN";
    if (endedText.test(bodyText) && !hasJoin && !hasLeave) return "ENDED";
    return "UNKNOWN";
  };

  const summarizeText = (element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return "";
    const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > 120) return "[omitted]";
    return text.slice(0, 80);
  };

  const captureSnapshot = (current) => {
    const nodes = [];
    const seen = new Set();
    const candidates = document.querySelectorAll(
      `${SIDEBAR},header,footer,nav,aside,video,audio,canvas,${DIALOG},[data-testid],[role],[aria-label]`
    );
    for (const element of candidates) {
      if (!(element instanceof HTMLElement) || seen.has(element) || !visible(element)) continue;
      seen.add(element);
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      nodes.push({
        tag: element.tagName.toLowerCase(),
        testid: element.getAttribute("data-testid") || "",
        role: element.getAttribute("role") || "",
        ariaLabel: (element.getAttribute("aria-label") || "").slice(0, 80),
        className: String(element.className || "").slice(0, 120),
        text: summarizeText(element),
        rect: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
        display: style.display,
        visibility: style.visibility,
      });
      if (nodes.length >= 50) break;
    }
    lastCapture = { state: current, path: location.pathname, nodeCount: nodes.length, nodes };
    try {
      console.info("[telemost-isolation] capture", current, nodes.length);
    } catch (_) { /* ignore */ }
  };

  const hideSidebar = () => {
    let hidden = 0;
    for (const element of document.querySelectorAll(SIDEBAR)) {
      if (!(element instanceof HTMLElement) || !visible(element)) continue;
      if (hide(element)) {
        hidden += 1;
        record("hidden sidebar");
        console.info("[telemost-isolation] hidden sidebar");
      }
    }
    return hidden;
  };

  const hideTariff = () => {
    let hidden = 0;
    for (const element of document.querySelectorAll("a,button,span,p")) {
      if (!(element instanceof HTMLElement) || !visible(element) || inDialog(element)) continue;
      if (!tariffText.test(controlLabel(element))) continue;
      if (hide(element)) {
        hidden += 1;
        record("hidden tariff");
        console.info("[telemost-isolation] hidden tariff");
        break;
      }
    }
    return hidden;
  };

  const footerScore = (text) => footerBits.reduce((score, bit) => score + (bit.test(text) ? 1 : 0), 0);

  const hideFooter = () => {
    let hidden = 0;
    const height = innerHeight;
    const width = innerWidth;
    for (const element of document.querySelectorAll("footer")) {
      if (!(element instanceof HTMLElement) || !visible(element) || inDialog(element)) continue;
      if (isAppRootish(element) || coversMostViewport(element) || containsProtectedSurface(element)) continue;
      const rect = element.getBoundingClientRect();
      const text = (element.innerText || "").replace(/\s+/g, " ");
      const bottom = rect.bottom > height - 16 && rect.height > 0 && rect.height <= 120 && rect.width > width * 0.5;
      if (!bottom || footerScore(text) < 2) continue;
      if (hide(element)) {
        hidden += 1;
        record("hidden footer");
        console.info("[telemost-isolation] hidden footer");
        break;
      }
    }
    return hidden;
  };

  const countHidden = () => document.querySelectorAll(`.${HIDDEN}`).length;

  const stopLeaveWatch = () => {
    if (leavePoll !== null) {
      clearInterval(leavePoll);
      leavePoll = null;
    }
  };

  const teardownObserver = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (transitionPoll !== null) {
      clearInterval(transitionPoll);
      transitionPoll = null;
    }
  };

  const becomeDormant = () => {
    stopLeaveWatch();
    teardownObserver();
    unhideAll();
    meetingApplied = false;
    lastReadyBeacon = "";
  };

  const watchTransition = () => {
    if (transitionPoll !== null) return;
    let ticks = 0;
    transitionPoll = setInterval(() => {
      ticks += 1;
      if (state !== "TRANSITION" || ticks > 80) {
        if (transitionPoll !== null) {
          clearInterval(transitionPoll);
          transitionPoll = null;
        }
        return;
      }
      apply();
    }, 250);
  };

  const watchLeave = () => {
    if (leavePoll !== null) return;
    leavePoll = setInterval(() => {
      if (state !== "MEETING") {
        stopLeaveWatch();
        return;
      }
      apply();
    }, 250);
  };

  const hideProvenShell = () => {
    ensureStyle();
    hideSidebar();
    hideTariff();
    hideFooter();
  };

  const enterTransition = () => {
    if (state === "TRANSITION") return;
    record(`state ${state}→TRANSITION`);
    console.info(`[telemost-isolation] state ${state}→TRANSITION`);
    state = "TRANSITION";
    console.info("[telemost-isolation] state=TRANSITION");
    teardownObserver();
    unhideAll();
    record("transition fail-open");
    console.info("[telemost-isolation] transition fail-open");
    watchTransition();
  };

  const apply = () => {
    scheduled = false;
    lastApplyAt = Date.now();
    applyCount += 1;
    try {
      const next = detectState();
      if (next !== state) {
        if (state !== "UNKNOWN" || events.length) {
          record(`state ${state}→${next}`);
          console.info(`[telemost-isolation] state ${state}→${next}`);
        }
        if (next === "TRANSITION" && state !== "TRANSITION") {
          teardownObserver();
          unhideAll();
          record("transition fail-open");
          watchTransition();
        }
        if (next === "ENDED" || next === "ERROR" || next === "HOME" || next === "UNKNOWN") {
          becomeDormant();
        }
        if (state === "MEETING" && next !== "MEETING") {
          stopLeaveWatch();
          meetingApplied = false;
        }
        if (next === "MEETING") meetingApplied = false;
        state = next;
        console.info(`[telemost-isolation] state=${state}`);
      }
      if (state === "PREJOIN") emitVisualReady("PREJOIN");
      if (state === "MEETING") emitVisualReady("MEETING");
      if (state === "PREJOIN" && lastCapture?.state !== "PREJOIN") captureSnapshot("PREJOIN");
      if (state === "MEETING" && lastCapture?.state !== "MEETING") captureSnapshot("MEETING");
      if (state === "UNKNOWN") {
        if (document.body && document.body.childElementCount > 0) {
          record("fail-open unknown DOM");
          console.info("[telemost-isolation] fail-open unknown DOM");
        }
        hiddenCount = countHidden();
        return;
      }
      if (state === "TRANSITION" || state === "HOME" || state === "ENDED" || state === "ERROR") {
        hiddenCount = countHidden();
        return;
      }
      if (state === "MEETING") {
        if (!meetingApplied) {
          hideProvenShell();
          meetingApplied = true;
          teardownObserver();
          watchLeave();
        }
        hiddenCount = countHidden();
        return;
      }
      if (state !== "PREJOIN") {
        hiddenCount = countHidden();
        return;
      }
      hideProvenShell();
      armObserver();
      hiddenCount = countHidden();
    } catch (_) {
      record("fail-open unknown DOM");
      console.info("[telemost-isolation] fail-open unknown DOM");
      unhideAll();
      hiddenCount = countHidden();
    }
  };

  const bumpIdle = () => {
    if (!lastReadyBeacon) return;
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = setTimeout(teardownObserver, OBSERVER_MS);
  };

  const schedule = () => {
    if (state === "TRANSITION" || state === "MEETING" || scheduled) return;
    scheduled = true;
    // The native create mask is an opaque sibling webview pinned over this one
    // until PREJOIN/MEETING is reported, and WebKit suspends requestAnimationFrame
    // while a WKWebView is occluded. Without a timer fallback `apply` never runs,
    // the readiness title is never set, and the native watchdog fails closed.
    let ran = false;
    const run = () => {
      if (ran) return;
      ran = true;
      apply();
      if (observer) bumpIdle();
    };
    requestAnimationFrame(run);
    setTimeout(run, SCHEDULE_FALLBACK_MS);
  };

  const armObserver = () => {
    if (state === "TRANSITION" || state === "MEETING") return;
    const root = document.documentElement || document.body;
    if (!root) return;
    if (!observer) {
      observer = new MutationObserver(() => {
        observerCallbacks += 1;
        schedule();
      });
      observer.observe(root, { childList: true, subtree: true });
    }
    bumpIdle();
  };

  const onJoinClick = (event) => {
    const target = event.target instanceof Element ? event.target.closest("a,button,[role=button]") : null;
    if (!(target instanceof HTMLElement) || inGlobalBar(target)) return;
    if (!joinControl.test(controlLabel(target)) && !isRememberedJoin(target)) return;
    rememberJoin(target);
    enterTransition();
  };

  const stop = () => {
    becomeDormant();
    if (historyHooked) {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      historyHooked = false;
    }
  };

  window.__o360TelemostSurfaceIsolation = {
    get state() { return state; },
    get hiddenCount() { return hiddenCount; },
    get events() { return events.slice(); },
    get observerActive() { return observer != null; },
    get leaveWatchActive() { return leavePoll != null; },
    get transitionPollActive() { return transitionPoll != null; },
    get lastApplyAt() { return lastApplyAt; },
    get lastCapture() { return lastCapture; },
    get applyCount() { return applyCount; },
    get observerCallbacks() { return observerCallbacks; },
    get lastReadyBeacon() { return lastReadyBeacon; },
    apply,
    stop,
  };
  window.__o360TelemostJoinClick = onJoinClick;

  const start = () => {
    if (!document.body) return;
    if (!window.__o360TelemostJoinClickBound) {
      window.__o360TelemostJoinClickBound = true;
      document.addEventListener("click", (event) => {
        window.__o360TelemostJoinClick?.(event);
      }, true);
    }
    if (!window.__o360TelemostPopstateBound) {
      window.__o360TelemostPopstateBound = true;
      addEventListener("popstate", () => {
        const iso = window.__o360TelemostSurfaceIsolation;
        if (!iso || iso.state === "TRANSITION") return;
        iso.apply();
      });
    }
    if (!historyHooked) {
      historyHooked = true;
      const onHistory = () => {
        if (state === "TRANSITION") return;
        apply();
      };
      history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        onHistory();
        return result;
      };
      history.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        onHistory();
        return result;
      };
    }
    armObserver();
    schedule();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
