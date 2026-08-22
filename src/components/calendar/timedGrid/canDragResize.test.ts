import { describe, expect, it } from "vitest";
import type { CalendarProviderCapabilities } from "@/services/calendar/domain";
import { canDragResizeTimedEvent } from "./canDragResize";

function capabilities(
  overrides: Partial<CalendarProviderCapabilities> = {},
): CalendarProviderCapabilities {
  return {
    events: { create: "remote", update: "remote", delete: "remote" },
    recurrence: { updateScopes: ["single", "series"], deleteScopes: ["single", "series"] },
    ...overrides,
  } as CalendarProviderCapabilities;
}

const timed = {
  is_all_day: 0,
  status: "confirmed",
  is_recurrence_master: 0,
  occurrence_key: null as string | null,
  series_uid: null as string | null,
  uid: "plain-1",
  time_kind: "timed-zoned" as const,
};

describe("canDragResizeTimedEvent", () => {
  it("allows timed writable events", () => {
    expect(canDragResizeTimedEvent(timed, capabilities())).toBe(true);
  });

  it("disables drag when the provider cannot update remotely", () => {
    expect(canDragResizeTimedEvent(timed, capabilities({
      events: { create: "remote", update: "unsupported", delete: "remote" },
    }))).toBe(false);
  });

  it("disables all-day and cancelled events", () => {
    expect(canDragResizeTimedEvent({ ...timed, is_all_day: 1 }, capabilities())).toBe(false);
    expect(canDragResizeTimedEvent({ ...timed, time_kind: "all-day" }, capabilities())).toBe(false);
    expect(canDragResizeTimedEvent({ ...timed, status: "cancelled" }, capabilities())).toBe(false);
  });

  it("disables interaction when capabilities are missing", () => {
    expect(canDragResizeTimedEvent(timed, null)).toBe(false);
  });
});
