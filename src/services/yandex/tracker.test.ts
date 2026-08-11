import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { listTrackerQueues, uploadTrackerAttachment } from "./tracker";
import { getStoredYandexOrgId, getYandexServiceContext } from "./accountApi";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("./accountApi", () => ({
  getYandexServiceContext: vi.fn(),
  getStoredYandexOrgId: vi.fn(),
  parseApiError: vi.fn(),
}));

describe("Yandex Tracker native HTTP transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getYandexServiceContext).mockResolvedValue({
      account: { id: "account-id" },
      token: "work-token",
    } as never);
    vi.mocked(getStoredYandexOrgId).mockResolvedValue("org-id");
  });

  it("loads Tracker data outside the WebView CORS boundary", async () => {
    vi.mocked(tauriFetch).mockResolvedValue(new Response(JSON.stringify([{ id: "queue-1" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(listTrackerQueues("account-id")).resolves.toEqual([{ id: "queue-1" }]);
    expect(tauriFetch).toHaveBeenCalledWith(
      "https://api.tracker.yandex.net/v3/queues?perPage=100",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "OAuth work-token", "X-Org-ID": "org-id" }),
      }),
    );
  });

  it("uploads attachments through the same native transport", async () => {
    vi.mocked(tauriFetch).mockResolvedValue(new Response(JSON.stringify({ id: "file-1", name: "note.txt" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(uploadTrackerAttachment("account-id", "TEST-1", "note.txt", new Uint8Array([1, 2]))).resolves.toMatchObject({ id: "file-1" });
    expect(tauriFetch).toHaveBeenCalledWith(
      "https://api.tracker.yandex.net/v3/issues/TEST-1/attachments",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
  });
});
