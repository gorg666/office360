import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveYandexMessengerSession, yandexMessengerSourceKey } from "./yandexMessengerSession";
import { loadMessengerCredentials } from "./credentials";

vi.mock("./credentials", () => ({ loadMessengerCredentials: vi.fn() }));

describe("resolveYandexMessengerSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the saved Yandex Bot Platform token", async () => {
    vi.mocked(loadMessengerCredentials).mockReturnValue({ providerId: "yandex", token: " bot-token ", savedAt: 1 });

    const session = await resolveYandexMessengerSession("active-yandex");

    expect(session).toEqual({ token: "bot-token", manual: true });
    expect(yandexMessengerSourceKey(session!)).toBe("bot:bot-token");
  });

  it("does not pass a user OAuth token to Bot API", async () => {
    vi.mocked(loadMessengerCredentials).mockReturnValue(null);

    await expect(resolveYandexMessengerSession("active-yandex")).resolves.toBeNull();
  });
});
