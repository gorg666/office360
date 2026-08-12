(() => {
  if (window.__o360TelemostIsolation) return;
  if (!/^\/j\/[^/?#]+/.test(location.pathname)) return;

  const HIDDEN = "o360-telemost-shell-hidden";
  const STYLE_ID = "o360-telemost-isolation-style";
  // Meeting-only phrases — exclude GlobalBar "Настройки"/generic "settings"/"join".
  const meetingControl = /продолжить в браузере|подключиться|микрофон|камера|участники|демонстрац|выйти из встречи|leave (the )?meeting|continue in browser|join (meeting|call)|microphone|camera|participants|share screen/i;
  const footerText = /поддержка|частые вопросы|скачать на windows|скачать на mac|скачать на телефон|support|frequently asked|download for|download on/i;
  const tariffText = /тарифы для бизнеса|business plans|улучшить тариф/;
  const downloadPromo = /скачать на mac|скачать на windows|скачать на телефон|скачайте новую|отдельную программу|download (the )?(new )?app|download for mac/i;
  let scheduled = false;
  let isolated = false;
  let observer;

  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  const inGlobalBar = (element) => !!(element.closest?.("[data-testid='orb-global-bar'],[data-orb-global-bar='true'],[class*='GlobalBarRoot'],[class*='globalBar_']"));

  const controlLabel = (element) => (element.innerText || element.textContent || element.getAttribute("aria-label") || "").trim();

  const meetingReady = () => [...document.querySelectorAll("button,a,[role=button],[aria-label]")]
    .some((element) => visible(element) && !inGlobalBar(element) && meetingControl.test(controlLabel(element)));

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
    if (element === document.body || element === document.documentElement) return false;
    element.classList.add(HIDDEN);
    return true;
  };

  const hideSemanticChrome = () => {
    let hidden = 0;
    // Live DOM (telemost.yandex.ru /j/...): stable GlobalBar root attrs.
    for (const element of document.querySelectorAll("[data-testid='orb-global-bar'],[data-orb-global-bar='true'],[class*='GlobalBarRoot']")) {
      if (!(element instanceof HTMLElement) || !visible(element)) continue;
      if (hide(element)) hidden += 1;
    }
    for (const element of document.querySelectorAll("a,button,[role=button]")) {
      if (!(element instanceof HTMLElement) || !visible(element)) continue;
      const label = controlLabel(element).toLowerCase();
      if (!tariffText.test(label) && !downloadPromo.test(label) && !/^скачать$|^download$/i.test(label.trim())) continue;
      // Prefer a compact header/promo ancestor; never hide the full-page root wrappers.
      let target = element;
      let node = element.parentElement;
      for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
        if (!(node instanceof HTMLElement)) break;
        const rect = node.getBoundingClientRect();
        if (rect.height > 0 && rect.height <= 120 && rect.width > innerWidth * 0.4) target = node;
        if (downloadPromo.test((node.innerText || "").replace(/\s+/g, " ").toLowerCase()) && rect.height <= Math.min(420, innerHeight * 0.55)) {
          target = node;
        }
      }
      if (hide(target)) hidden += 1;
    }
    return hidden;
  };

  const hideGeometryChrome = () => {
    let hidden = 0;
    const width = innerWidth;
    const height = innerHeight;
    // Same scan scope as Windows CEF compact isolation (`header,footer,body *`).
    for (const element of document.querySelectorAll("header,footer,body *")) {
      if (!(element instanceof HTMLElement) || element.classList.contains(HIDDEN) || !visible(element)) continue;
      const rect = element.getBoundingClientRect();
      const text = (element.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
      const controls = element.querySelectorAll("a,button").length;
      const globalRail = rect.left < 12 && rect.width >= 36 && rect.width <= 110 && rect.height > height * 0.55 && controls >= 5;
      const globalHeader = rect.top < 40 && rect.height <= 110 && rect.width > width * 0.65 && tariffText.test(text);
      const globalFooter = rect.bottom > height - 8 && rect.height <= 140 && rect.width > width * 0.5 && footerText.test(text);
      if ((globalRail || globalHeader || globalFooter) && hide(element)) hidden += 1;
    }
    return hidden;
  };

  const fitMeeting = () => {
    const available = Math.max(480, innerHeight);
    const factor = Math.min(1, Math.max(0.65, available / 1120));
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.zoom = String(factor);
    document.documentElement.style.width = "100%";
    document.documentElement.style.height = "100%";
    document.body.style.width = "100%";
    document.body.style.height = "100%";
  };

  const apply = () => {
    scheduled = false;
    if (!/^\/j\/[^/?#]+/.test(location.pathname) || !meetingReady()) return;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `.${HIDDEN}{display:none!important}`
        + `html[data-o360-telemost-surface=isolated],html[data-o360-telemost-surface=isolated] body{margin:0!important;padding:0!important;background:#000!important}`;
      document.documentElement.appendChild(style);
    }
    const hidden = hideSemanticChrome() + hideGeometryChrome();
    if (hidden > 0 || !shellStillVisible()) {
      isolated = true;
      document.documentElement.dataset.o360TelemostSurface = "isolated";
      fitMeeting();
    }
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(apply);
  };

  window.__o360TelemostIsolation = {
    apply: schedule,
    state: () => (isolated ? "ISOLATED" : "PENDING"),
    shellVisible: shellStillVisible,
  };

  const start = () => {
    if (!document.body) return;
    schedule();
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    addEventListener("popstate", schedule);
    addEventListener("resize", schedule);
    addEventListener("beforeunload", () => observer?.disconnect(), { once: true });
    setTimeout(() => {
      if (!/^\/j\/[^/?#]+/.test(location.pathname)) return;
      if (meetingReady() && shellStillVisible()) {
        document.title = "__O360_TELEMOST_SURFACE_DEGRADED__";
      }
    }, 15000);
  };

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
