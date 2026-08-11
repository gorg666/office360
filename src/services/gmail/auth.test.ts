import { describe, it, expect, beforeEach, vi } from "vitest";
import { startOAuthFlow } from "./auth";

const mockInvoke = vi.fn();
const mockOpenUrl = vi.fn();
const mockFetch = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, handler: (event: { payload: { port: number } }) => void) => {
    handler({ payload: { port: 17248 } });
    return () => {};
  }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();

  mockInvoke.mockImplementation(async (_command, args: { state: string }) => ({
    code: "auth-code",
    state: args.state,
  }));
  mockOpenUrl.mockResolvedValue(undefined);
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "gmail",
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        email: "user@gmail.com",
        name: "User",
        picture: "https://example.com/avatar.png",
      }),
    });
  vi.stubGlobal("fetch", mockFetch);
});

describe("startOAuthFlow", () => {
  it("uses PKCE without client secret for desktop credentials", async () => {
    const result = await startOAuthFlow("client-id");

    expect(result.tokens.access_token).toBe("access-token");
    const tokenRequest = mockFetch.mock.calls[0]![1] as { body: URLSearchParams };
    expect(tokenRequest.body.get("client_id")).toBe("client-id");
    expect(tokenRequest.body.get("code_verifier")).toBeTruthy();
    expect(tokenRequest.body.has("client_secret")).toBe(false);
  });

  it("includes client secret only when a non-empty secret is configured", async () => {
    await startOAuthFlow("client-id", "client-secret");

    const tokenRequest = mockFetch.mock.calls[0]![1] as { body: URLSearchParams };
    expect(tokenRequest.body.get("client_secret")).toBe("client-secret");
  });
});
