(() => {
  const onMeeting = /^\/j\/[^/?#]+/.test(location.pathname);
  const onTelemostHost = /^(?:telemost\.yandex\.ru|telemost\.360\.yandex\.ru)$/.test(location.hostname);
  const onPassport = /^(?:passport|oauth)\.yandex\.(?:ru|com)$/.test(location.hostname);
  if (onPassport || !onTelemostHost || !onMeeting) return;
  if (window.__o360TelemostPromoDismiss) return;

  const OBSERVER_MS = 12000;
  const headingText = /вы подключаетесь к видеовстрече|you are (?:joining|connecting to) (?:a |the )?video meeting/i;
  const continueCta = /^\s*(продолжить в браузере|continue in browser)\s*$/i;
  const permissionText = /разрешить камер|разрешить микрофон|camera and microphone|access to (your )?(camera|microphone)/i;
  const clicked = typeof WeakSet === "function" ? new WeakSet() : null;
  const events = [];
  let observer = null;
  let timeoutId = null;
  let stopped = false;
  let clickedCount = 0;

  const record = (name) => { events.push(name); };

  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  const controlLabel = (element) => (
    element.innerText || element.textContent || element.getAttribute("aria-label") || ""
  ).replace(/\s+/g, " ").trim();

  const isAppRootish = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    if (element === document.body || element === document.documentElement) return true;
    if (element.id === "root" || element.id === "app") return true;
    const rect = element.getBoundingClientRect();
    return rect.width >= innerWidth * 0.85 && rect.height >= innerHeight * 0.75;
  };

  const isCompact = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      && rect.width <= innerWidth * 0.75
      && rect.height <= innerHeight * 0.65;
  };

  const isPermissionSurface = (element) => {
    const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ");
    return permissionText.test(text) && !headingText.test(text);
  };

  const alreadyClicked = (element) => clicked ? clicked.has(element) : false;
  const markClicked = (element) => { if (clicked) clicked.add(element); };

  const findConfirmedPromo = () => {
    const ctas = [...document.querySelectorAll("a,button,[role=button]")].filter((element) => (
      element instanceof HTMLElement && visible(element) && continueCta.test(controlLabel(element))
    ));
    for (const cta of ctas) {
      if (alreadyClicked(cta)) continue;
      let node = cta.parentElement;
      for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
        if (!(node instanceof HTMLElement) || isAppRootish(node)) break;
        if (isPermissionSurface(node)) break;
        if (node.querySelector("video,canvas,audio")) break;
        if (!isCompact(node)) continue;
        const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ");
        if (!headingText.test(text)) continue;
        const innerCta = [...node.querySelectorAll("a,button,[role=button]")].find((element) => (
          element instanceof HTMLElement && visible(element) && continueCta.test(controlLabel(element)) && !alreadyClicked(element)
        ));
        if (innerCta instanceof HTMLElement) return { promo: node, cta: innerCta };
      }
    }
    return null;
  };

  const stop = () => {
    stopped = true;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const tryDismiss = () => {
    if (stopped) return false;
    const found = findConfirmedPromo();
    if (!found) return false;
    record("PROMO DETECTED");
    record("PROMO CTA DETECTED");
    markClicked(found.cta);
    try {
      found.cta.click();
      clickedCount += 1;
      record("PROMO CLICKED");
    } catch (_) { /* ignore */ }
    return true;
  };

  const start = () => {
    record("PROMO DISMISS SCRIPT READY");
    if (tryDismiss()) {
      stop();
      return;
    }
    observer = new MutationObserver(() => {
      if (tryDismiss()) stop();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    timeoutId = setTimeout(stop, OBSERVER_MS);
  };

  window.__o360TelemostPromoDismiss = {
    get events() { return events.slice(); },
    get clicked() { return clickedCount; },
    stop,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
