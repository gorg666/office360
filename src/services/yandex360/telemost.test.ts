import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAccount: vi.fn(), getAllAccounts: vi.fn(), getToken: vi.fn() }));
vi.mock("@/services/db/accounts", () => ({ getAccount: mocks.getAccount, getAllAccounts: mocks.getAllAccounts }));
vi.mock("@/services/oauth/yandexUnifiedAuth", () => ({ getYandexGrantAccessToken: mocks.getToken }));
import { createTelemostConference, deleteTelemostConference, getTelemostConference, TelemostApiError, updateTelemostConference } from "./telemost";

const API_BODY = { id: "conf-1", join_url: "https://telemost.yandex.ru/j/123456789", status: "CREATED" };
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.getAccount.mockResolvedValue({ id: "acc-1", oauth_provider: "yandex", auth_method: "oauth2" });
  mocks.getToken.mockResolvedValue("communications-token");
});

describe("Telemost API service", () => {
  it("creates and normalizes a conference", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(API_BODY), { status: 200 }))); expect(await createTelemostConference({ accountId: "acc-1" })).toMatchObject({ id: "conf-1", title: null, status: "CREATED" }); });
  it("reads a conference", async () => { const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(API_BODY), { status: 200 })); vi.stubGlobal("fetch", fetch); await getTelemostConference("acc-1", "conf-1"); expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/conferences/conf-1"), expect.objectContaining({ method: "GET" })); });
  it("updates a conference", async () => { const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(API_BODY), { status: 200 })); vi.stubGlobal("fetch", fetch); await updateTelemostConference({ accountId: "acc-1", id: "conf-1", waitingRoomLevel: "PUBLIC" }); expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/conferences/conf-1"), expect.objectContaining({ method: "PATCH" })); });
  it.each([[401, "auth"], [429, "rate_limit"]] as const)("normalizes HTTP %s", async (status, code) => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status }))); await expect(createTelemostConference({ accountId: "acc-1" })).rejects.toMatchObject({ code, status }); });
  it("normalizes missing scope 403", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "insufficient scope" }), { status: 403 }))); await expect(createTelemostConference({ accountId: "acc-1" })).rejects.toMatchObject({ code: "missing_scope" }); });
  it("normalizes the exact organization restriction", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "ApiRestrictedToOrganizations", message: "API доступен пользователям Яндекс 360 для бизнеса." }), { status: 403 }))); await expect(createTelemostConference({ accountId: "acc-1" })).rejects.toMatchObject({ code: "organization_restricted" }); });
  it("does not classify a generic 403 as web-only", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Forbidden", message: "Conference access forbidden" }), { status: 403 }))); await expect(createTelemostConference({ accountId: "acc-1" })).rejects.toMatchObject({ code: "conference_forbidden" }); });
  it("does not fall back to the core OAuth token", async () => { mocks.getToken.mockRejectedValue(new Error("grant missing")); await expect(createTelemostConference({ accountId: "acc-1" })).rejects.toBeInstanceOf(TelemostApiError); expect(fetch).not.toHaveBeenCalled(); });
  it("deletes a conference with the communications token", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await deleteTelemostConference("acc-1", "conf-1");
    expect(mocks.getToken).toHaveBeenCalledWith("acc-1", "communications");
    expect(fetch).toHaveBeenCalledWith(
      "https://cloud-api.yandex.net/v1/telemost-api/conferences/conf-1",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ Authorization: "OAuth communications-token" }),
      }),
    );
  });
  it("treats 404 delete as already gone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    await expect(deleteTelemostConference("acc-1", "missing")).resolves.toBeUndefined();
  });
  it("keeps 403 delete as a missing-scope error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "insufficient scope" }), { status: 403 })));
    await expect(deleteTelemostConference("acc-1", "conf-1")).rejects.toMatchObject({ code: "missing_scope", status: 403 });
  });
});
