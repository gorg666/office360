import { participantRefFromEmail } from "../domain";
import { AccountRemoteFreeBusyAdapter, type AccountRemoteFreeBusyDependencies } from "./remoteAdapter";
import type { ParticipantAvailability, RemoteFreeBusyAdapter } from "./types";

const participant = participantRefFromEmail("other@example.com");
const request = { participants: [participant], range: { start: 10, end: 20 }, timeZone: "UTC" } as const;

function result(): ParticipantAvailability[] {
  return [{ participant, reliability: "known", source: "remote-provider", busy: [], range: { ...request.range },
    timeZone: "UTC", observedAt: 10, dataAsOf: 10, diagnostics: [] }];
}

describe("AccountRemoteFreeBusyAdapter", () => {
  it("routes Google accounts and coalesces/cache-hits an identical query", async () => {
    let now = 1_000;
    let resolve!: (value: ParticipantAvailability[]) => void;
    const queryAvailability = vi.fn(() => new Promise<ParticipantAvailability[]>((done) => { resolve = done; }));
    const delegate: RemoteFreeBusyAdapter = {
      accountId: "account-1", providerType: "google_api", source: "remote-provider",
      canAnswer: () => true, queryAvailability,
    };
    const deps: AccountRemoteFreeBusyDependencies = {
      getAccount: vi.fn(async () => ({ id: "account-1", provider: "gmail_api" }) as never),
      google: () => delegate,
      caldav: vi.fn(),
      now: () => now,
    };
    const adapter = new AccountRemoteFreeBusyAdapter("account-1", deps);

    expect(await adapter.canAnswer(participant)).toBe(true);
    const first = adapter.queryAvailability([participant], request);
    const second = adapter.queryAvailability([participant], request);
    await vi.waitFor(() => expect(queryAvailability).toHaveBeenCalledOnce());
    resolve(result());
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(queryAvailability).toHaveBeenCalledOnce();

    await adapter.queryAvailability([participant], request);
    expect(queryAvailability).toHaveBeenCalledOnce();
    now += 60_001;
    queryAvailability.mockResolvedValueOnce(result());
    await adapter.queryAvailability([participant], request);
    expect(queryAvailability).toHaveBeenCalledTimes(2);
  });

  it("does not infer Yandex remote support from product UI capability", async () => {
    const deps: AccountRemoteFreeBusyDependencies = {
      getAccount: vi.fn(async () => ({
        id: "yandex", provider: "imap", calendar_provider: "caldav", oauth_provider: "yandex",
        auth_method: "oauth2", email: "self@yandex.ru",
      }) as never),
      google: vi.fn(), now: () => 0,
      caldav: vi.fn(() => ({ canAnswer: () => false }) as never),
    };
    await expect(new AccountRemoteFreeBusyAdapter("yandex", deps).canAnswer(participant)).resolves.toBe(false);
    expect(deps.google).not.toHaveBeenCalled();
  });
});
