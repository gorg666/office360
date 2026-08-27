/**
 * EFIM-AUTH-SESSION-SPLIT-005: coordinate Telemost CEF vs Add-Account OAuth UI.
 *
 * - While OAuth is open: Telemost CEF must stay hidden (no overlay).
 * - After OAuth ends: CEF stays held until Telemost page unmounts (user left)
 *   or an explicit Telemost action (open/create meeting) releases the hold.
 */

type Listener = () => void;

let oauthFlowActive = false;
let cefHoldAfterAuth = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function isOAuthFlowActive(): boolean {
  return oauthFlowActive;
}

/** True while OAuth runs or after auth until Telemost is explicitly resumed. */
export function isTelemostCefSuspended(): boolean {
  return oauthFlowActive || cefHoldAfterAuth;
}

export function beginOAuthUi(): void {
  oauthFlowActive = true;
  cefHoldAfterAuth = true;
  notify();
}

export function endOAuthUi(): void {
  oauthFlowActive = false;
  // Keep cefHoldAfterAuth — Telemost stays hidden until releaseTelemostCefHold / unmount.
  notify();
}

/** Explicit Telemost resume (openMeeting / leave page). Clears post-auth hold and any stale OAuth-active flag. */
export function releaseTelemostCefHold(): void {
  if (!cefHoldAfterAuth && !oauthFlowActive) return;
  oauthFlowActive = false;
  cefHoldAfterAuth = false;
  notify();
}

export function subscribeOAuthUiGate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
