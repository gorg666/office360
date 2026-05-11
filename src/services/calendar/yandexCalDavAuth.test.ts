import { loginYandexCalDavClient } from "./yandexCalDavAuth";

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: globalThis.fetch.bind(globalThis),
}));

const mockLogin = vi.fn();

vi.mock("tsdav", () => ({
  DAVClient: vi.fn(function (this: { login: () => Promise<void> }) {
    this.login = mockLogin;
  }),
}));

describe("loginYandexCalDavClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns client when OAuth-style login succeeds", async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    await loginYandexCalDavClient("https://caldav.yandex.ru/", "token");
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  it("falls back to Bearer when OAuth login throws Invalid credentials", async () => {
    mockLogin
      .mockRejectedValueOnce(new Error("Invalid credentials"))
      .mockResolvedValueOnce(undefined);
    await loginYandexCalDavClient("https://caldav.yandex.ru/", "token");
    expect(mockLogin).toHaveBeenCalledTimes(2);
  });

  it("rethrows non-auth errors from first login", async () => {
    mockLogin.mockRejectedValueOnce(new Error("Network down"));
    await expect(loginYandexCalDavClient("https://caldav.yandex.ru/", "token")).rejects.toThrow("Network down");
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });
});
