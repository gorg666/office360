(() => {
  const telemostHost = () => /^(?:telemost\.yandex\.ru|telemost\.360\.yandex\.ru)$/.test(location.hostname);
  const passportHost = () => /^(?:sso\.passport|passport|oauth)\.yandex\.(?:ru|com)$/.test(location.hostname);
  const joinPath = () => /^\/j\/[^/?#]+/.test(location.pathname);
  const homeEpoch = () => (telemostHost() && !joinPath() ? `${location.hostname}|${location.pathname}|${location.search}` : "");

  if (passportHost() || !telemostHost() || joinPath()) return;

  // Exact official HOME create tile. Do not match generic "Создать" or Office360 "Новая видеовстреча".
  const CREATE_CTA = /^\s*(создать видеовстречу|create video meeting)\s*$/i;
  // PREJOIN/MEETING chrome only. HOME also has "Подключиться" — that must not abort CREATE.
  const JOIN_CTA = /^\s*(присоединиться|продолжить|join)\s*$/i;
  const LEAVE_CTA = /^\s*(выйти|покинуть встречу|покинуть|leave)\s*$/i;
  const events = [];
  let clicked = false;
  let observer = null;
  let timeoutId = null;
  let stopped = false;
  let ambiguousLogged = false;
  let epoch = homeEpoch();

  const record = (name) => {
    events.push(name);
    console.info("[telemost-create] " + name);
  };

  // CSS display/visibility on the control itself. Do NOT require a user-visible layout rect:
  // CREATE_PENDING covers the mounted WKWebView; the DOM can still be fully interactive.
  const inDocument = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
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

  const arm = () => {
    if (observer || stopped) return;
    observer = new MutationObserver(() => apply());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (timeoutId === null) timeoutId = setTimeout(stop, 12000);
  };

  const syncEpoch = () => {
    const next = homeEpoch();
    if (!next || next === epoch) return;
    epoch = next;
    clicked = false;
    stopped = false;
    ambiguousLogged = false;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    record("epoch reset");
    arm();
  };

  const apply = () => {
    if (passportHost() || !telemostHost()) return;
    if (joinPath()) {
      record("/j/ captured");
      stop();
      return;
    }
    syncEpoch();
    if (stopped || clicked) return;
    if (document.readyState !== "complete") return;
    if (hasJoinOrLeave()) {
      record("skip PREJOIN/MEETING chrome");
      stop();
      return;
    }
    const matches = findOfficialCreateCtas();
    if (matches.length > 1) {
      if (!ambiguousLogged) {
        record("ambiguous CTA");
        ambiguousLogged = true;
      }
      return;
    }
    const cta = matches[0];
    if (!(cta instanceof HTMLElement)) return;
    record("official CTA matched");
    clicked = true;
    cta.click();
    record("clicked once");
  };

  if (window.__o360TelemostOfficialCreate) {
    window.__o360TelemostOfficialCreate.kick();
    return;
  }

  record("state=HOME");
  document.addEventListener("readystatechange", apply);
  const api = {
    events,
    get clicked() { return clicked ? 1 : 0; },
    stop,
    kick: apply,
  };
  window.__o360TelemostOfficialCreate = api;
  apply();
  if (clicked || stopped) return;
  arm();
})();
