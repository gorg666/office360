import { participantRefFromEmail } from "../domain";
import { GoogleRemoteFreeBusyAdapter, type GoogleRemoteFreeBusyDependencies } from "./googleRemoteAdapter";

const range = {
  start: Date.parse("2026-08-22T00:00:00Z") / 1000,
  end: Date.parse("2026-08-23T00:00:00Z") / 1000,
};

function dependencies(
  request: GoogleRemoteFreeBusyDependencies["request"],
): GoogleRemoteFreeBusyDependencies {
  return { request, now: () => range.start };
}

describe("GoogleRemoteFreeBusyAdapter", () => {
  it("uses the privacy-limited batch endpoint and maps busy/free participants", async () => {
    const request = vi.fn(async () => ({ calendars: {
      "busy@example.com": { busy: [{ start: "2026-08-22T10:00:00Z", end: "2026-08-22T11:00:00Z" }] },
      "free@example.com": { busy: [] },
    } }));
    const adapter = new GoogleRemoteFreeBusyAdapter("account-1", dependencies(request));

    const result = await adapter.queryAvailability(
      [participantRefFromEmail("busy@example.com"), participantRefFromEmail("free@example.com")],
      { participants: [], range, timeZone: "UTC" },
    );

    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect(JSON.parse(String(request.mock.calls[0][1].body))).toMatchObject({
      calendarExpansionMax: 50,
      items: [{ id: "busy@example.com" }, { id: "free@example.com" }],
    });
    expect(result.find((entry) => entry.participant.normalizedEmail === "busy@example.com")?.busy)
      .toEqual([{ start: range.start + 36_000, end: range.start + 39_600, busyType: "busy" }]);
    expect(result.find((entry) => entry.participant.normalizedEmail === "free@example.com"))
      .toMatchObject({ reliability: "known", busy: [], source: "remote-provider" });
    expect(JSON.stringify(result)).not.toContain("summary");
  });

  it("splits batches at the documented 50-calendar limit", async () => {
    const request = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body)) as { items: Array<{ id: string }> };
      return { calendars: Object.fromEntries(body.items.map(({ id }) => [id, { busy: [] }])) };
    });
    const adapter = new GoogleRemoteFreeBusyAdapter("account-1", dependencies(request));
    const participants = Array.from({ length: 101 }, (_, index) => participantRefFromEmail(`p${index}@example.com`));

    const result = await adapter.queryAvailability(participants, {
      participants, range, timeZone: "UTC",
    });

    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.map((call) => JSON.parse(String(call[1].body)).items.length)).toEqual([50, 50, 1]);
    expect(result).toHaveLength(101);
  });

  it("isolates per-calendar permission and provider errors", async () => {
    const request = vi.fn(async () => ({ calendars: {
      "denied@example.com": { errors: [{ reason: "notFound" }] },
      "failed@example.com": { errors: [{ reason: "internalError" }] },
      "free@example.com": { busy: [] },
    } }));
    const participants = ["denied", "failed", "free"].map((name) => participantRefFromEmail(`${name}@example.com`));
    const result = await new GoogleRemoteFreeBusyAdapter("account-1", dependencies(request))
      .queryAvailability(participants, { participants, range, timeZone: "UTC" });

    expect(result.map((entry) => entry.reliability).sort()).toEqual(["error", "known", "permission-denied"]);
  });

  it("keeps successful batches when another HTTP batch fails", async () => {
    const request = vi.fn(async (_url: string, options: RequestInit) => {
      const items = (JSON.parse(String(options.body)) as { items: Array<{ id: string }> }).items;
      if (items[0]?.id === "p50@example.com") throw new Error("Google API error: 403 forbidden");
      return { calendars: Object.fromEntries(items.map(({ id }) => [id, { busy: [] }])) };
    });
    const participants = Array.from({ length: 51 }, (_, index) => participantRefFromEmail(`p${index}@example.com`));
    const result = await new GoogleRemoteFreeBusyAdapter("account-1", dependencies(request))
      .queryAvailability(participants, { participants, range, timeZone: "UTC" });

    expect(result.filter((entry) => entry.reliability === "known")).toHaveLength(50);
    expect(result.filter((entry) => entry.reliability === "permission-denied")).toHaveLength(1);
  });

  it("forwards AbortSignal and rejects an already aborted request", async () => {
    const request = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(new GoogleRemoteFreeBusyAdapter("account-1", dependencies(request)).queryAvailability(
      [participantRefFromEmail("p@example.com")],
      { participants: [], range, timeZone: "UTC", options: { signal: controller.signal } },
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(request).not.toHaveBeenCalled();
  });
});
