const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mockFetch }));

import { calDavSessionFetch, isCalDavAuthFailure } from "./caldavAuthFailure";

describe("CalDAV auth failure guard", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("surfaces 401 as an authentication failure", async () => {
    mockFetch.mockResolvedValue(new Response("Unauthorized", { status: 401 }));

    await expect(calDavSessionFetch("https://dav.example.test/")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("surfaces only auth-related 403 responses", async () => {
    mockFetch.mockResolvedValueOnce(new Response("access token expired", { status: 403 }));
    await expect(calDavSessionFetch("https://dav.example.test/")).rejects.toMatchObject({
      status: 403,
    });

    const permissionResponse = new Response("Forbidden", { status: 403 });
    mockFetch.mockResolvedValueOnce(permissionResponse);
    await expect(calDavSessionFetch("https://dav.example.test/")).resolves.toBe(permissionResponse);
  });

  it("preserves the valid initial discovery 404 probe", async () => {
    const discoveryProbe = new Response("Not Found", { status: 404 });
    mockFetch.mockResolvedValue(discoveryProbe);

    await expect(calDavSessionFetch("https://dav.example.test/probe")).resolves.toBe(discoveryProbe);
    expect(isCalDavAuthFailure(new Error("Collection query failed: 404 Not Found"))).toBe(false);
  });
});
