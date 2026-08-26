import { describe, expect, it } from "vitest";
import type { CalendarProviderCapabilities } from "@/services/calendar/domain";
import { canDragDateEvent } from "./canDragDateEvent";

function capabilities(
  overrides: Partial<CalendarProviderCapabilities> = {},
): CalendarProviderCapabilities {
  return {
    events: { create: "remote", update: "remote", delete: "remote" },
    recurrence: { updateScopes: ["single", "series"], deleteScopes: ["single", "series"] },
    ...overrides,
  } as CalendarProviderCapabilities;
}

const writable = {
  status: "confirmed",
  is_recurrence_master: 0,
  occurrence_key: null as string | null,
  series_uid: null as string | null,
  uid: "plain-1",
};

describe("canDragDateEvent", () => {
  it("allows writable all-day and timed events", () => {
    expect(canDragDateEvent(writable, capabilities())).toBe(true);
  });

  it("blocks read-only calendars, cancelled events, and missing capabilities", () => {
    expect(canDragDateEvent(writable, capabilities({
      events: { create: "remote", update: "unsupported", delete: "remote" },
    }))).toBe(false);
    expect(canDragDateEvent({ ...writable, status: "cancelled" }, capabilities())).toBe(false);
    expect(canDragDateEvent(writable, null)).toBe(false);
  });
});
