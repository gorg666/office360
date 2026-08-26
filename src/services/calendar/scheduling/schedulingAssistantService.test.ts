import { describe, expect, it } from "vitest";
import type { FreeBusyService } from "../freeBusy";
import { flattenSchedulingParticipants, SchedulingAssistantService } from "./schedulingAssistantService";
import { HOUR, availability, busy, ref } from "./testFixtures";

const DAY = Date.UTC(2026, 2, 16) / 1000;
const RANGE = { start: DAY + 9 * HOUR, end: DAY + 12 * HOUR };
const ivan = ref("ivan");
const anna = ref("anna");
const petr = ref("petr");

const FORBIDDEN_EVENT_KEYS = [
  "title", "summary", "description", "location", "uid", "UID",
  "rawIcs", "rawICS", "remoteEventId", "remote_event_id", "href",
];

function stubFreeBusy(service: Pick<FreeBusyService, "queryAvailability">): FreeBusyService {
  return service as FreeBusyService;
}

describe("SchedulingAssistantService", () => {
  it("treats a duplicate optional identity as required", () => {
    const participants = flattenSchedulingParticipants([ivan], [ivan, anna]);
    expect(participants).toHaveLength(2);
    expect(participants[0]).toMatchObject({ role: "required", identityKey: expect.stringContaining("ivan") });
    expect(participants[1]?.role).toBe("optional");
  });

  it("returns unknown, not free, for a remote unsupported participant", async () => {
    const assistant = new SchedulingAssistantService(stubFreeBusy({
      async queryAvailability(request) {
        return {
          range: request.range,
          timeZone: request.timeZone,
          participants: [
            availability(ivan, "known", [], request.range),
            availability(petr, "unsupported", [], request.range),
          ],
        };
      },
    }));

    const result = await assistant.planMeeting({
      requiredParticipants: [ivan, petr],
      range: RANGE,
      durationSeconds: HOUR,
      timeZone: "UTC",
      options: { granularitySeconds: HOUR },
    });

    expect(result.participants.map((entry) => entry.reliability)).toEqual(["known", "unsupported"]);
    expect(result.candidates.every((slot) => slot.classification === "unknown")).toBe(true);
    expect(result.candidates.every((slot) => slot.unknownParticipants.includes(1))).toBe(true);
    expect(result.suggestions.every((slot) => slot.classification !== "blocked")).toBe(true);
  });

  it("keeps optional busy out of blocked and still explains the conflict", async () => {
    const assistant = new SchedulingAssistantService(stubFreeBusy({
      async queryAvailability(request) {
        return {
          range: request.range,
          timeZone: request.timeZone,
          participants: [
            availability(ivan, "known", [], request.range),
            availability(anna, "known", [busy(DAY + 10 * HOUR, DAY + 11 * HOUR)], request.range),
          ],
        };
      },
    }));

    const result = await assistant.planMeeting({
      requiredParticipants: [ivan],
      optionalParticipants: [anna],
      range: RANGE,
      durationSeconds: HOUR,
      timeZone: "Europe/Moscow",
      options: { granularitySeconds: HOUR },
    });

    const conflicted = result.candidates.find((slot) => slot.start === DAY + 10 * HOUR)!;
    expect(conflicted.classification).toBe("confirmed");
    expect(conflicted.optionalConflicts).toEqual([{ participantIndex: 1, reason: "busy" }]);
    expect(result.segments.some((segment) => segment.optionalBusy.includes(1))).toBe(true);
  });

  it("never carries event details in the assistant payload", async () => {
    const assistant = new SchedulingAssistantService(stubFreeBusy({
      async queryAvailability(request) {
        return {
          range: request.range,
          timeZone: request.timeZone,
          participants: [availability(ivan, "known", [busy(DAY + 10 * HOUR, DAY + 11 * HOUR)], request.range)],
        };
      },
    }));

    const result = await assistant.planMeeting({
      requiredParticipants: [ivan],
      range: RANGE,
      durationSeconds: HOUR,
      timeZone: "UTC",
      options: { granularitySeconds: HOUR },
    });

    const serialized = JSON.stringify(result);
    for (const key of FORBIDDEN_EVENT_KEYS) {
      expect(serialized).not.toContain(`"${key}"`);
    }
    for (const interval of result.availability.flatMap((entry) => entry.busy)) {
      expect(Object.keys(interval).sort()).toEqual(["busyType", "end", "start"]);
    }
  });
});
