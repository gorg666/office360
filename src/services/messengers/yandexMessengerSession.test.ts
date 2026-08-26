import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveYandexMessengerSession } from "./yandexMessengerSession";
import { loadMessengerCredentials } from "./credentials";

vi.mock("./credentials", () => ({ loadMessengerCredentials: vi.fn() }));

describe("resolveYandexMessengerSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses only the saved organization bot token and never user OAuth", async () => {
    vi.mocked(loadMessengerCredentials).mockReturnValue({
      providerId: "yandex",
      token: "bot-token",
      savedAt: 1,
    });

    await expect(resolveYandexMessengerSession("active-yandex")).resolves.toEqual({
      token: "bot-token",
      manual: true,
    });
  });

  it("returns null when no bot token is configured", async () => {
    vi.mocked(loadMessengerCredentials).mockReturnValue(null);
    await expect(resolveYandexMessengerSession(null)).resolves.toBeNull();
  });
});
