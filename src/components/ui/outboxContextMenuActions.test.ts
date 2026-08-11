import { describe, expect, it } from "vitest";
import {
  canSafelyCancelOutboxSend,
  isOutboxContextActionEnabled,
  mapOutboxContextPhase,
} from "./outboxContextMenuActions";

describe("mapOutboxContextPhase", () => {
  it("maps queued/pending to queued", () => {
    expect(mapOutboxContextPhase("queued")).toBe("queued");
    expect(mapOutboxContextPhase("pending")).toBe("queued");
  });

  it("maps mid-send to sending", () => {
    expect(mapOutboxContextPhase("executing")).toBe("sending");
    expect(mapOutboxContextPhase("sending")).toBe("sending");
  });

  it("maps reconcile states", () => {
    expect(mapOutboxContextPhase("smtp_accepted")).toBe("sent_reconciling");
    expect(mapOutboxContextPhase("sent_reconciling")).toBe("sent_reconciling");
  });

  it("maps failed", () => {
    expect(mapOutboxContextPhase("failed")).toBe("failed");
  });
});

describe("isOutboxContextActionEnabled", () => {
  it("queued: open + cancel only", () => {
    expect(isOutboxContextActionEnabled("open", "queued")).toBe(true);
    expect(isOutboxContextActionEnabled("cancel-send", "queued")).toBe(true);
    expect(isOutboxContextActionEnabled("retry", "queued")).toBe(false);
    expect(isOutboxContextActionEnabled("delete", "queued")).toBe(false);
  });

  it("sending: status only, no cancel", () => {
    expect(isOutboxContextActionEnabled("open-status", "sending")).toBe(true);
    expect(isOutboxContextActionEnabled("cancel-send", "sending")).toBe(false);
    expect(canSafelyCancelOutboxSend("sending")).toBe(false);
  });

  it("failed: draft + retry + delete", () => {
    expect(isOutboxContextActionEnabled("open-draft", "failed")).toBe(true);
    expect(isOutboxContextActionEnabled("retry", "failed")).toBe(true);
    expect(isOutboxContextActionEnabled("delete", "failed")).toBe(true);
    expect(isOutboxContextActionEnabled("cancel-send", "failed")).toBe(false);
  });

  it("sent_reconciling: status only", () => {
    expect(isOutboxContextActionEnabled("open-status", "sent_reconciling")).toBe(true);
    expect(isOutboxContextActionEnabled("delete", "sent_reconciling")).toBe(false);
  });
});
