import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAccount } from "@/services/db/accounts";
import { getYandexGrantAccessToken } from "@/services/oauth/yandexUnifiedAuth";
import { createTelemostConference } from "./telemost";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@/services/db/accounts", () => ({ getAccount: vi.fn(), getAllAccounts: vi.fn() }));
vi.mock("@/services/oauth/yandexUnifiedAuth", () => ({ getYandexGrantAccessToken: vi.fn() }));

describe("createTelemostConference", () => {
  it("uses native HTTP with the Communications token", async () => {
    vi.mocked(getAccount).mockResolvedValue({ id: "acc-1", oauth_provider: "yandex", auth_method: "oauth2" } as never);
    vi.mocked(getYandexGrantAccessToken).mockResolvedValue("communications-token");
    vi.mocked(tauriFetch).mockResolvedValue(new Response(JSON.stringify({ id: "42", join_url: "https://telemost.yandex.ru/j/42" }), { status: 200 }));

    await expect(createTelemostConference({ accountId: "acc-1" })).resolves.toMatchObject({ id: "42", joinUrl: "https://telemost.yandex.ru/j/42" });
    expect(tauriFetch).toHaveBeenCalledWith("https://cloud-api.yandex.net/v1/telemost-api/conferences", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "OAuth communications-token" }),
    }));
  });
});
