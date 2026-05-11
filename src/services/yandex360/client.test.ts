import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeYandex360Operation, interpolatePath, yandex360Request } from "./client";

vi.mock("./auth", () => ({
  getYandex360AccessToken: vi.fn(() => Promise.resolve("stored-token")),
}));

describe("yandex360 client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("interpolates path parameters safely", () => {
    expect(interpolatePath("/v1/orgs/{orgId}/users/{userId}", {
      orgId: "org 1",
      userId: "user@example.com",
    })).toBe("/v1/orgs/org%201/users/user%40example.com");
  });

  it("sends OAuth authorization header and parses JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const result = await yandex360Request({
      token: "direct-token",
      method: "GET",
      path: "/v1/orgs",
      query: { pageSize: 50 },
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://cloud-api.yandex.net/v1/orgs?pageSize=50",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "OAuth direct-token",
        }),
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("executes catalog operations", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ users: [] }), { status: 200 }),
    );

    const result = await executeYandex360Operation({
      endpointId: "users.list",
      token: "token",
      pathParams: { orgId: "123" },
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://cloud-api.yandex.net/v1/orgs/123/users",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toEqual({ users: [] });
  });

  it("throws a readable error on failed responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("forbidden", { status: 403, statusText: "Forbidden" }),
    );

    await expect(
      yandex360Request({ token: "token", method: "GET", path: "/v1/orgs" }),
    ).rejects.toThrow("Недостаточно прав");
  });
});
