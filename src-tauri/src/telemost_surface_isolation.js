(() => {
  const nativeGen = Number(window.__o360IsolationNativeGen || 0);
  const onMeeting = /^\/j\/[^/?#]+/.test(location.pathname);
  const onTelemostHost = /telemost(?:\.360)?\.yandex\.ru$/.test(location.hostname);
  const onPassport = /(?:^|\.)passport\.yandex\.(?:ru|com)$/.test(location.hostname)
    || /(?:^|\.)oauth\.yandex\.(?:ru|com)$/.test(location.hostname);
  const onTelemostApp = !onPassport && (onMeeting || (onTelemostHost && (location.pathname === "/" || location.pathname === "")));
  if (window.__o360TelemostIsolation) {
    if (onTelemostApp) window.__o360TelemostIsolation.adoptGeneration(nativeGen);
    return;
  }
  if (!onTelemostApp) return;

  const HIDDEN = "o360-telemost-shell-hidden";
  const STYLE_ID = "o360-telemost-isolation-style";
  const OBSERVER_MS = 12000;
  const GLOBAL_BAR = "[data-testid='orb-global-bar'],[data-orb-global-bar='true'],[class*='GlobalBarRoot'],[class*='globalBar_']";
  const DIALOG = "[role='dialog'],[role='alertdialog'],[aria-modal='true']";
  // Real meeting/prejoin controls — NEVER include open-in-browser (that is chrome to remove).
  const meetingSurfaceControl = /подключиться|копировать ссылку|микрофон|камера|участники|чат|настройки|выйти из встречи|leave (the )?meeting|join (meeting|call)|copy link|microphone|camera|participants|chat|settings/i;
  const footerText = /поддержка|частые вопросы|скачать на windows|скачать на mac|скачать на телефон|support|frequently asked|download for|download on/i;
  const tariffText = /тарифы для бизнеса|business plans|улучшить тариф/;
  const downloadPromo = /скачать на mac|скачать на windows|скачать на телефон|скачайте новую|отдельную программу|download (the )?(new )?app|download for mac/i;
  const openInBrowser = /продолжить в браузере|открыть в (новом )?браузере|open in (the )?browser|continue in browser/i;
  const interstitialHeading = /вы подключаетесь к видеовстрече|you are (?:joining|connecting to) (?:a |the )?video meeting/i;
  const permissionText = /разрешить камер|разрешить микрофон|camera and microphone|access to (your )?(camera|microphone)/i;
  let scheduled = false;
  let isolated = false;
  let observer = null;
  let timeoutId = null;
  let generation = nativeGen;
  let popstateBound = false;
  let interstitialClickedGen = -1;

  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  const inGlobalBar = (element) => !!(element.closest?.(GLOBAL_BAR));
  const inDialog = (element) => !!(element.closest?.(DIALOG));
  const controlLabel = (element) => (element.innerText || element.textContent || element.getAttribute("aria-label") || "").trim();

  const isAppRootish = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    if (element === document.body || element === document.documentElement) return true;
    if (element.id === "root" || element.id === "app") return true;
    const rect = element.getBoundingClientRect();
    const nearFull = rect.width >= innerWidth * 0.85 && rect.height >= innerHeight * 0.75;
    if (element.parentElement === document.body && nearFull) return true;
    if (nearFull && element.querySelector("main,video,canvas,[data-testid='orb-global-bar']")) return true;
    return false;
  };

  /** Structural protection: any media or real meeting control under the node. */
  const containsProtectedSurface = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    if (element.querySelector("video,canvas,audio")) return true;
    return [...element.querySelectorAll("a,button,[role=button],[aria-label]")].some((node) => {
      if (!(node instanceof HTMLElement) || inGlobalBar(node)) return false;
      const label = controlLabel(node);
      if (openInBrowser.test(label)) return false;
      return meetingSurfaceControl.test(label);
    });
  };

  const realMeetingSurfaceReady = () => {
    if (document.querySelector("video,canvas")) return true;
    return [...document.querySelectorAll("a,button,[role=button],[aria-label]")].some((element) => {
      if (!(element instanceof HTMLElement) || !visible(element) || inGlobalBar(element)) return false;
      const label = controlLabel(element);
      return meetingSurfaceControl.test(label) && !openInBrowser.test(label);
    });
  };

  const shellStillVisible = () => {
    const bar = document.querySelector("[data-testid='orb-global-bar'],[data-orb-global-bar='true']");
    if (bar instanceof HTMLElement && visible(bar) && !bar.classList.contains(HIDDEN)) return true;
    const width = innerWidth;
    const height = innerHeight;
    for (const element of document.querySelectorAll("header,footer,body *")) {
      if (!(element instanceof HTMLElement) || element.classList.contains(HIDDEN) || !visible(element)) continue;
      const rect = element.getBoundingClientRect();
      const text = (element.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
      const controls = element.querySelectorAll("a,button").length;
      if (rect.left < 12 && rect.width >= 36 && rect.width <= 110 && rect.height > height * 0.55 && controls >= 5) return true;
      if (rect.top < 40 && rect.height <= 110 && rect.width > width * 0.65 && tariffText.test(text)) return true;
      if (rect.bottom > height - 8 && rect.height <= 140 && rect.width > width * 0.5 && footerText.test(text)) return true;
    }
    return false;
  };

  const hide = (element) => {
    if (!(element instanceof HTMLElement) || element.classList.contains(HIDDEN)) return false;
    if (isAppRootish(element)) return false;
    if (inDialog(element) && !openInBrowser.test(controlLabel(element) + " " + (element.innerText || ""))) return false;
    if (element.tagName === "VIDEO" || element.tagName === "CANVAS" || element.tagName === "AUDIO") return false;
    if (containsProtectedSurface(element)) return false;
    element.classList.add(HIDDEN);
    return true;
  };

  const hideNode = (element) => {
    if (!(element instanceof HTMLElement) || element.classList.contains(HIDDEN)) return false;
    if (isAppRootish(element)) return false;
    if (element.tagName === "VIDEO" || element.tagName === "CANVAS" || element.tagName === "AUDIO") return false;
    if (containsProtectedSurface(element)) return false;
    // Never climb-hide a near-fullscreen shell; interstitial must stay compact.
    const rect = element.getBoundingClientRect();
    if (rect.width >= innerWidth * 0.9 || rect.height >= innerHeight * 0.85) return false;
    element.classList.add(HIDDEN);
    return true;
  };

  const isPermissionSurface = (element) => {
    const text = (element.innerText || "").replace(/\s+/g, " ");
    return permissionText.test(text) && !openInBrowser.test(text);
  };

  const findInterstitialTarget = () => {
    const ctas = [...document.querySelectorAll("a,button,[role=button]")].filter((element) => (
      element instanceof HTMLElement && visible(element) && openInBrowser.test(controlLabel(element))
    ));
    let best = null;
    for (const cta of ctas) {
      let target = null;
      let node = cta;
      for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
        if (!(node instanceof HTMLElement) || isAppRootish(node)) break;
        if (isPermissionSurface(node)) { target = null; break; }
        // Refuse any ancestor that owns meeting media/controls — FIRST BAD STAGE=2 root cause.
        if (containsProtectedSurface(node)) break;
        const text = (node.innerText || "").replace(/\s+/g, " ");
        const hasHeading = interstitialHeading.test(text);
        const hasCta = openInBrowser.test(text);
        const dialogish = !!(node.matches?.(DIALOG) || node.getAttribute("role") === "dialog");
        const rect = node.getBoundingClientRect();
        const compact = rect.width > 0 && rect.height > 0
          && rect.width <= innerWidth * 0.75
          && rect.height <= innerHeight * 0.65;
        if (!hasCta || !compact) continue;
        if (!(hasHeading || dialogish)) continue;
        target = node;
        if ((hasHeading && dialogish) || (hasHeading && depth >= 1)) break;
      }
      if (target && (!best || target.getBoundingClientRect().height < best.getBoundingClientRect().height)) best = target;
    }
    return best;
  };

  const findOpenInBrowserCta = () => [...document.querySelectorAll("a,button,[role=button]")].find((element) => (
    element instanceof HTMLElement && visible(element) && !inGlobalBar(element) && openInBrowser.test(controlLabel(element))
  )) || null;

  /**
   * Stage-2 live failure: display:none on the gate interstitial before the SPA
   * mounts prejoin/video → gray skeleton + white card. Advance via click first;
   * only hide the compact interstitial once real meeting surface exists.
   */
  const advanceOrHideInterstitial = () => {
    const candidate = findInterstitialTarget();
    if (realMeetingSurfaceReady()) {
      if (candidate && hideNode(candidate)) return { hidden: 1, clicked: false };
      // Remnant CTA without a compact card — hide the button only.
      const cta = findOpenInBrowserCta();
      if (cta && hideNode(cta)) return { hidden: 1, clicked: false };
      return { hidden: 0, clicked: false };
    }
    if (interstitialClickedGen === generation) return { hidden: 0, clicked: false };
    const cta = (candidate && [...candidate.querySelectorAll("a,button,[role=button]")].find((el) => (
      el instanceof HTMLElement && visible(el) && openInBrowser.test(controlLabel(el))
    ))) || findOpenInBrowserCta();
    if (cta instanceof HTMLElement) {
      interstitialClickedGen = generation;
      try { cta.click(); } catch (_) { /* ignore */ }
      return { hidden: 0, clicked: true };
    }
    return { hidden: 0, clicked: false };
  };

  const hideGlobalBarOnly = () => {
    let hidden = 0;
    for (const element of document.querySelectorAll(GLOBAL_BAR)) {
      if (!(element instanceof HTMLElement) || !visible(element)) continue;
      if (hide(element)) hidden += 1;
    }
    return hidden;
  };

  const hideTariffDownloadChrome = () => {
    let hidden = 0;
    for (const element of document.querySelectorAll("a[href*='telemost.yandex.ru/download'],a[href*='/download/'],a[href*='redirect=browser']")) {
      if (!(element instanceof HTMLElement) || !visible(element) || inDialog(element)) continue;
      if (hide(element)) hidden += 1;
    }
    for (const element of document.querySelectorAll("a,button,[role=button]")) {
      if (!(element instanceof HTMLElement) || !visible(element) || inDialog(element)) continue;
      const label = controlLabel(element).toLowerCase();
      const isDownload = tariffText.test(label) || downloadPromo.test(label) || /^скачать$|^download$/i.test(label.trim());
      if (!isDownload) continue;
      let target = element;
      let node = element.parentElement;
      for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
        if (!(node instanceof HTMLElement) || inDialog(node) || isAppRootish(node) || containsProtectedSurface(node)) break;
        const rect = node.getBoundingClientRect();
        if (rect.height > 0 && rect.height <= 120 && rect.width > innerWidth * 0.4) target = node;
        if (downloadPromo.test((node.innerText || "").replace(/\s+/g, " ").toLowerCase()) && rect.height <= Math.min(420, innerHeight * 0.55)) {
          target = node;
        }
      }
      if (hide(target)) hidden += 1;
    }
    const width = innerWidth;
    const height = innerHeight;
    for (const element of document.querySelectorAll("header,footer")) {
      if (!(element instanceof HTMLElement) || element.classList.contains(HIDDEN) || !visible(element) || inDialog(element)) continue;
      if (isAppRootish(element) || containsProtectedSurface(element)) continue;
      const rect = element.getBoundingClientRect();
      const text = (element.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
      const globalHeader = rect.top < 40 && rect.height <= 110 && rect.width > width * 0.65 && tariffText.test(text);
      const globalFooter = rect.bottom > height - 8 && rect.height <= 140 && rect.width > width * 0.5 && footerText.test(text);
      if ((globalHeader || globalFooter) && hide(element)) hidden += 1;
    }
    return hidden;
  };

  const hideStandaloneChrome = () => hideGlobalBarOnly() + hideTariffDownloadChrome();

  const expandMeetingSurface = () => {
    // Layout CSS only on documentElement/body — never on nodes that own video/meeting tree.
    const styleRules = [
      `.${HIDDEN}{display:none!important}`,
      `html[data-o360-telemost-surface=isolated],html[data-o360-telemost-surface=isolated] body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important}`,
      `html[data-o360-telemost-surface=isolated] #root,html[data-o360-telemost-surface=isolated] #app{width:100%!important;max-width:none!important;margin:0!important}`,
    ];
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }
    style.textContent = styleRules.join("");
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.width = "100%";
    document.documentElement.style.height = "100%";
    document.body.style.width = "100%";
    document.body.style.height = "100%";
  };

  const teardownObserver = () => {
    observer?.disconnect();
    observer = null;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const applyOffice360TelemostLayout = () => {
    scheduled = false;
    const meeting = /^\/j\/[^/?#]+/.test(location.pathname);
    const home = /telemost(?:\.360)?\.yandex\.ru$/.test(location.hostname)
      && (location.pathname === "/" || location.pathname === "");
    if (!meeting && !home) return;

    const ready = realMeetingSurfaceReady();
    const interstitialCandidate = findInterstitialTarget();
    const openCta = findOpenInBrowserCta();
    if (!ready && !interstitialCandidate && !openCta) return;

    let interstitialHidden = 0;
    let hidden = 0;
    const result = advanceOrHideInterstitial();
    interstitialHidden = result.hidden;
    if (result.clicked) {
      // Let Telemost SPA mount prejoin/video; chrome hide runs on next schedule.
      schedule();
      return;
    }
    // GlobalBar / tariff / download only after real meeting surface is present.
    if (ready) {
      hidden += hideGlobalBarOnly();
      hidden += hideTariffDownloadChrome();
    }
    if (!ready && interstitialHidden === 0 && hidden === 0) return;
    isolated = true;
    document.documentElement.dataset.o360TelemostSurface = "isolated";
    document.documentElement.dataset.o360IsolationGeneration = String(generation);
    expandMeetingSurface();
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(applyOffice360TelemostLayout);
  };

  const observeTelemostSpaChanges = () => {
    if (observer || !document.body) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    timeoutId = setTimeout(() => {
      teardownObserver();
    }, OBSERVER_MS);
  };

  const bindWindow = () => {
    if (popstateBound) return;
    popstateBound = true;
    addEventListener("popstate", schedule);
    addEventListener("resize", schedule);
  };

  const adoptGeneration = (gen) => {
    const next = Number(gen || 0);
    if (next > generation) {
      generation = next;
      isolated = false;
      interstitialClickedGen = -1;
      teardownObserver();
      if (document.body) observeTelemostSpaChanges();
    }
    schedule();
  };

  window.__o360TelemostIsolation = {
    apply: schedule,
    applyOffice360TelemostLayout: schedule,
    hideStandaloneChrome,
    hideOpenInBrowserInterstitial: () => advanceOrHideInterstitial().hidden,
    expandMeetingSurface,
    observeTelemostSpaChanges,
    adoptGeneration,
    teardownObserver,
    generation: () => generation,
    observerActive: () => observer != null,
    state: () => (isolated ? "ISOLATED" : "PENDING"),
    shellVisible: shellStillVisible,
    findInterstitialTarget,
    realMeetingSurfaceReady,
  };

  const start = () => {
    if (!document.body) return;
    bindWindow();
    observeTelemostSpaChanges();
    schedule();
  };

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
