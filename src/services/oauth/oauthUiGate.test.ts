import { afterEach, describe, expect, it } from "vitest";
import {
  beginOAuthUi,
  endOAuthUi,
  isOAuthFlowActive,
  isTelemostCefSuspended,
  releaseTelemostCefHold,
  subscribeOAuthUiGate,
} from "./oauthUiGate";

afterEach(() => {
  endOAuthUi();
  releaseTelemostCefHold();
});

describe("oauthUiGate (EFIM-AUTH-SESSION-SPLIT-005)", () => {
  it("suspends Telemost CEF for the whole OAuth flow and keeps hold after end", () => {
    expect(isTelemostCefSuspended()).toBe(false);
    beginOAuthUi();
    expect(isOAuthFlowActive()).toBe(true);
    expect(isTelemostCefSuspended()).toBe(true);
    endOAuthUi();
    expect(isOAuthFlowActive()).toBe(false);
    expect(isTelemostCefSuspended()).toBe(true);
    releaseTelemostCefHold();
    expect(isTelemostCefSuspended()).toBe(false);
  });

  it("notifies subscribers on begin/end/release", () => {
    let ticks = 0;
    const stop = subscribeOAuthUiGate(() => {
      ticks += 1;
    });
    beginOAuthUi();
    endOAuthUi();
    releaseTelemostCefHold();
    stop();
    expect(ticks).toBe(3);
  });

  it("explicit release clears stale oauthFlowActive so openMeeting can resume CEF", () => {
    beginOAuthUi();
    expect(isOAuthFlowActive()).toBe(true);
    expect(isTelemostCefSuspended()).toBe(true);
    releaseTelemostCefHold();
    expect(isOAuthFlowActive()).toBe(false);
    expect(isTelemostCefSuspended()).toBe(false);
  });
});
