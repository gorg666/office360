(() => {
  const onTelemostHost = /^(?:telemost\.yandex\.ru|telemost\.360\.yandex\.ru)$/.test(location.hostname);
  const onPassport = /^(?:sso\.passport|passport|oauth)\.yandex\.(?:ru|com)$/.test(location.hostname);
  if (onPassport || !onTelemostHost) return;
  if (window.__o360TelemostLeaveToIdle) return;

  const CREATE_CTA = /^\s*(создать видеовстречу|create video meeting)\s*$/i;
  // PREJOIN chrome only. HOME also has "Подключиться" — that must not block post-call IDLE.
  const PREJOIN_CTA = /^\s*(присоединиться|продолжить|join)\s*$/i;
  const LEAVE_CTA = /^\s*(выйти из встречи|выйти|покинуть встречу|покинуть|leave(?: the)? meeting|leave)\s*$/i;
  const RATING_COPY = /оцените качество связи|rate (?:the )?(?:connection|call) quality/i;
  const LEFT_TITLE = "__O360_TELEMOST_LEFT__";
  const RATING_WAIT_MS = 2000;
  let armed = false;
  let emitted = false;
  let sawLeave = false;
  let sawRating = false;
  let leavingAt = 0;
  let poll = null;
  let observer = null;

  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  const controlLabel = (element) => (
    element.innerText || element.textContent || element.getAttribute("aria-label") || ""
  ).replace(/\s+/g, " ").trim();

  const labeledControls = () => [...document.querySelectorAll("a,button,[role=button]")].filter((element) => (
    element instanceof HTMLElement && visible(element)
  ));

  const hasLabel = (regex) => labeledControls().some((element) => regex.test(controlLabel(element)));

  const isRatingModal = () => [...document.querySelectorAll('[role="dialog"], dialog, [aria-modal="true"]')].some((node) => {
    if (!(node instanceof HTMLElement) || !visible(node)) return false;
    const label = (node.innerText || node.textContent || node.getAttribute("aria-label") || "").replace(/\s+/g, " ");
    return RATING_COPY.test(label);
  });

  const emitLeft = () => {
    if (emitted) return;
    emitted = true;
    document.title = LEFT_TITLE;
    if (poll !== null) {
      clearInterval(poll);
      poll = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  };

  const onJoinPath = () => /^\/j\/[^/?#]+/.test(location.pathname);

  const apply = () => {
    if (emitted) return;
    if (hasLabel(LEAVE_CTA)) {
      armed = true;
      sawLeave = true;
      leavingAt = 0;
      return;
    }
    if (onJoinPath() && document.querySelector("video")) armed = true;
    if (!armed) return;
    if (isRatingModal()) {
      sawRating = true;
      leavingAt = 0;
      return;
    }
    if (hasLabel(PREJOIN_CTA)) return;
    // PREJOIN /j/ + promo video must not look like post-call HOME.
    if (!sawLeave && !sawRating) return;
    if (!leavingAt) leavingAt = Date.now();
    if (sawRating) {
      emitLeft();
      return;
    }
    // Wait for the official rating modal before treating HOME CREATE as ended.
    if (Date.now() - leavingAt < RATING_WAIT_MS) return;
    emitLeft();
  };

  poll = setInterval(apply, 250);
  observer = new MutationObserver(() => apply());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__o360TelemostLeaveToIdle = {
    get armed() { return armed; },
    get emitted() { return emitted; },
    get sawLeave() { return sawLeave; },
    get sawRating() { return sawRating; },
    stop() {
      if (poll !== null) {
        clearInterval(poll);
        poll = null;
      }
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },
  };
})();
