import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAccount } from "@/services/db/accounts";
import { ensureFreshToken } from "@/services/oauth/oauthTokenManager";
import { getYandexGrantAccessToken } from "@/services/oauth/yandexUnifiedAuth";
import { createTelemostConference, getTelemostConference, updateTelemostConference } from "./telemost";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@/services/db/accounts", () => ({ getAccount: vi.fn(), getAllAccounts: vi.fn() }));
vi.mock("@/services/oauth/yandexUnifiedAuth", () => ({ getYandexGrantAccessToken: vi.fn() }));
vi.mock("@/services/oauth/oauthTokenManager", () => ({ ensureFreshToken: vi.fn() }));

describe("Telemost native HTTP + Communications grant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccount).mockResolvedValue({
      id: "acc-1",
      oauth_provider: "yandex",
      auth_method: "oauth2",
    } as never);
    vi.mocked(getYandexGrantAccessToken).mockResolvedValue("communications-token");
  });

  it("creates conferences with native HTTP and the Communications token", async () => {
    vi.mocked(tauriFetch).mockResolvedValue(
      new Response(JSON.stringify({ id: "42", join_url: "https://telemost.yandex.ru/j/42" }), { status: 200 }),
    );

    await expect(createTelemostConference({ accountId: "acc-1" })).resolves.toMatchObject({
      id: "42",
      joinUrl: "https://telemost.yandex.ru/j/42",
    });
    expect(getYandexGrantAccessToken).toHaveBeenCalledWith("acc-1", "communications");
    expect(ensureFreshToken).not.toHaveBeenCalled();
    expect(tauriFetch).toHaveBeenCalledWith(
      "https://cloud-api.yandex.net/v1/telemost-api/conferences",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "OAuth communications-token" }),
      }),
    );
  });

  it("gets and updates conferences through the same Communications grant", async () => {
    vi.mocked(tauriFetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "42", join_url: "https://telemost.yandex.ru/j/42" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "42", join_url: "https://telemost.yandex.ru/j/42", waiting_room_level: "PUBLIC" }), {
          status: 200,
        }),
      );

    await expect(getTelemostConference("acc-1", "42")).resolves.toMatchObject({ id: "42" });
    await expect(updateTelemostConference({ accountId: "acc-1", id: "42", waitingRoomLevel: "PUBLIC" })).resolves.toMatchObject({
      id: "42",
    });
    expect(getYandexGrantAccessToken).toHaveBeenCalledWith("acc-1", "communications");
    expect(ensureFreshToken).not.toHaveBeenCalled();
  });

  it("does not fall back to the core account token when Communications is missing", async () => {
    vi.mocked(getYandexGrantAccessToken).mockRejectedValue(new Error("Подключите раздел «Мессенджер и Телемост»."));
    vi.mocked(ensureFreshToken).mockResolvedValue("core-token");

    await expect(createTelemostConference({ accountId: "acc-1" })).rejects.toThrow(/Мессенджер и Телемост|Подключите раздел/i);
    expect(ensureFreshToken).not.toHaveBeenCalled();
    expect(tauriFetch).not.toHaveBeenCalled();
  });
});
