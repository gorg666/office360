import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { YandexApiError } from "./accountApi";
import {
  createTrackerIssue,
  getTrackerAccessMode,
  getTrackerCooldownRemainingMs,
  getTrackerMyself,
  invalidateTrackerSessionCache,
  isTrackerViewModePayload,
  loadTrackerSessionMetadata,
  markTrackerAccessReadOnly,
  parseRetryAfter,
  resetTrackerAccessMode,
  resetTrackerRateLimitState,
  searchTrackerIssues,
  TRACKER_PERMISSION_DENIED_MESSAGE,
  TRACKER_RATE_LIMIT_FALLBACK_SEC,
  TRACKER_READ_ONLY_MESSAGE,
  updateTrackerIssue,
  uploadTrackerAttachment,
} from "./tracker";
import { getStoredYandexOrgId, getYandexServiceContext, parseApiError } from "./accountApi";

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

vi.mock("./accountApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./accountApi")>();
  return {
    ...actual,
    getYandexServiceContext: vi.fn(),
    getStoredYandexOrgId: vi.fn(),
    parseApiError: vi.fn(async (response: Response) => {
      return new actual.YandexApiError(response.status, `fallback ${response.status}`);
    }),
  };
});

function mockAuth() {
  vi.mocked(getYandexServiceContext).mockResolvedValue({
    account: { id: "acc-1", email: "user@yandex.ru" },
    token: "svc-token",
  } as never);
  vi.mocked(getStoredYandexOrgId).mockResolvedValue("8493916");
}

function jsonOk(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function jsonErr(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const parsed = typeof body === "string" ? { message: body } : body;
  return {
    ok: false,
    status,
    headers: { get: () => null },
    text: async () => text,
    json: async () => parsed,
  };
}

function rateLimited(headers: Record<string, string> = {}) {
  return {
    ok: false,
    status: 429,
    headers: {
      get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null,
    },
    text: async () => "",
    json: async () => ({}),
  };
}

describe("Tracker myself smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTrackerRateLimitState();
    resetTrackerAccessMode();
    invalidateTrackerSessionCache();
  });

  it("uses tauriFetch with OAuth and X-Org-ID, not browser fetch", async () => {
    const browserFetch = vi.fn();
    vi.stubGlobal("fetch", browserFetch);
    mockAuth();
    vi.mocked(tauriFetch).mockResolvedValue(jsonOk({ login: "user", email: "user@yandex.ru", display: "User" }) as never);

    await expect(getTrackerMyself("acc-1")).resolves.toMatchObject({ login: "user", email: "user@yandex.ru" });

    expect(tauriFetch).toHaveBeenCalledWith(
      "https://api.tracker.yandex.net/v3/myself",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "OAuth svc-token",
          "X-Org-ID": "8493916",
        }),
      }),
    );
    expect(browserFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("maps Tracker 401 to re-consent message", async () => {
    mockAuth();
    vi.mocked(tauriFetch).mockResolvedValue(jsonErr(401, { message: "Unauthorized" }) as never);

    await expect(getTrackerMyself("acc-1")).rejects.toThrow(/Необходимо обновить доступ к Яндекс Трекеру/i);
    expect(parseApiError).not.toHaveBeenCalled();
  });

  it("maps generic Tracker 403 to permission denied, not org/read-only", async () => {
    mockAuth();
    vi.mocked(tauriFetch).mockResolvedValue(jsonErr(403, { message: "Доступ запрещён" }) as never);

    await expect(getTrackerMyself("acc-1")).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(YandexApiError);
      expect((err as YandexApiError).code).toBe("tracker_permission_denied");
      expect((err as YandexApiError).message).toBe(TRACKER_PERMISSION_DENIED_MESSAGE);
      return true;
    });
    expect(getTrackerAccessMode()).toBe("UNKNOWN");
    expect(parseApiError).not.toHaveBeenCalled();
  });

  it("maps view-mode 403 body to READ_ONLY", async () => {
    mockAuth();
    vi.mocked(tauriFetch).mockResolvedValue(
      jsonErr(403, {
        statusCode: 403,
        errorMessages: [
          "В режиме просмотра нельзя создавать, редактировать и удалять объекты. Чтобы снять ограничения, подключите тариф с Трекером",
        ],
      }) as never,
    );

    await expect(createTrackerIssue("acc-1", { summary: "x", queue: "DEV" })).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(YandexApiError);
      expect((err as YandexApiError).code).toBe("tracker_read_only");
      expect((err as YandexApiError).message).toBe(TRACKER_READ_ONLY_MESSAGE);
      return true;
    });
    expect(getTrackerAccessMode()).toBe("READ_ONLY");
  });

  it("maps org-related 403 separately from read-only", async () => {
    mockAuth();
    vi.mocked(tauriFetch).mockResolvedValue(
      jsonErr(403, { errorMessages: ["Нет доступа к организации"] }) as never,
    );

    await expect(getTrackerMyself("acc-1")).rejects.toSatisfy((err: unknown) => {
      expect((err as YandexApiError).code).toBe("tracker_org_forbidden");
      return true;
    });
    expect(getTrackerAccessMode()).toBe("UNKNOWN");
  });

  it("blocks further writes after READ_ONLY without network", async () => {
    mockAuth();
    markTrackerAccessReadOnly();
    await expect(updateTrackerIssue("acc-1", "DEV-1", { summary: "n" })).rejects.toMatchObject({
      code: "tracker_read_only",
    });
    await expect(uploadTrackerAttachment("acc-1", "DEV-1", "a.png", new Uint8Array([1]))).rejects.toMatchObject({
      code: "tracker_read_only",
    });
    expect(tauriFetch).not.toHaveBeenCalled();
  });

  it("resetTrackerAccessMode allows re-evaluation", async () => {
    markTrackerAccessReadOnly();
    expect(getTrackerAccessMode()).toBe("READ_ONLY");
    resetTrackerAccessMode();
    expect(getTrackerAccessMode()).toBe("UNKNOWN");
  });

  it("detects view-mode payload without status alone", () => {
    expect(
      isTrackerViewModePayload({
        errorMessages: ["В режиме просмотра нельзя создавать объекты"],
      }),
    ).toBe(true);
    expect(isTrackerViewModePayload({ message: "Доступ запрещён" })).toBe(false);
  });

  it("maps transport exceptions to network message only", async () => {
    mockAuth();
    vi.mocked(tauriFetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(getTrackerMyself("acc-1")).rejects.toThrow(
      /Не удалось связаться с Яндекс Трекером\. Проверьте сеть и повторите/i,
    );
  });
});

describe("Tracker Retry-After / cooldown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTrackerRateLimitState();
    resetTrackerAccessMode();
    invalidateTrackerSessionCache();
    mockAuth();
  });

  it("parses Retry-After delta-seconds", () => {
    const now = 1_700_000_000_000;
    expect(parseRetryAfter("12", now)).toBe(now + 12_000);
  });

  it("parses Retry-After HTTP-date", () => {
    const date = "Wed, 21 Oct 2015 07:28:00 GMT";
    expect(parseRetryAfter(date)).toBe(Date.parse(date));
  });

  it("stores cooldown from 429 Retry-After seconds and blocks further network", async () => {
    vi.mocked(tauriFetch).mockResolvedValueOnce(rateLimited({ "Retry-After": "45" }));

    await expect(getTrackerMyself("acc-1")).rejects.toThrow(/Повторим через 45 сек/i);
    expect(getTrackerCooldownRemainingMs()).toBeGreaterThan(40_000);
    expect(tauriFetch).toHaveBeenCalledTimes(1);

    await expect(getTrackerMyself("acc-1")).rejects.toThrow(/Повторим через \d+ сек/i);
    expect(tauriFetch).toHaveBeenCalledTimes(1);
  });

  it("uses fallback cooldown when Retry-After missing", async () => {
    vi.mocked(tauriFetch).mockResolvedValueOnce(rateLimited());

    await expect(getTrackerMyself("acc-1")).rejects.toThrow(
      new RegExp(`Повторим через ${TRACKER_RATE_LIMIT_FALLBACK_SEC} сек`),
    );
    expect(getTrackerCooldownRemainingMs()).toBeGreaterThan(TRACKER_RATE_LIMIT_FALLBACK_SEC * 1000 - 2000);
  });

  it("does not retry-storm after metadata 429 (no issues search)", async () => {
    vi.mocked(tauriFetch).mockImplementation(async (url: string) => {
      if (String(url).includes("/myself")) return jsonOk({ login: "user" });
      if (String(url).includes("/queues")) return rateLimited({ "Retry-After": "20" });
      if (String(url).includes("/statuses")) return jsonOk([]);
      if (String(url).includes("/priorities")) return jsonOk([]);
      throw new Error(`unexpected ${url}`);
    });

    await expect(loadTrackerSessionMetadata("acc-1")).rejects.toThrow(/Повторим через/i);
    const calls = vi.mocked(tauriFetch).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/issues/_search"))).toBe(false);

    await expect(searchTrackerIssues("acc-1", { assignee: "me()" })).rejects.toThrow(/Повторим через/i);
    expect(calls.filter((u) => u.includes("/issues/_search")).length).toBe(0);
  });
});

describe("Tracker session metadata cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTrackerRateLimitState();
    resetTrackerAccessMode();
    invalidateTrackerSessionCache();
    mockAuth();
  });

  it("dedupes in-flight metadata loads (StrictMode / double init)", async () => {
    let resolveMyself!: (v: unknown) => void;
    const myselfGate = new Promise((resolve) => {
      resolveMyself = resolve;
    });

    vi.mocked(tauriFetch).mockImplementation(async (url: string) => {
      if (String(url).includes("/myself")) {
        await myselfGate;
        return jsonOk({ login: "user" });
      }
      if (String(url).includes("/queues")) return jsonOk([{ key: "TEST", name: "Test" }]);
      if (String(url).includes("/statuses")) return jsonOk([{ key: "open", display: "Open" }]);
      if (String(url).includes("/priorities")) return jsonOk([{ key: "normal", display: "Normal" }]);
      throw new Error(`unexpected ${url}`);
    });

    const a = loadTrackerSessionMetadata("acc-1");
    const b = loadTrackerSessionMetadata("acc-1");
    resolveMyself({});
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb);
    expect(vi.mocked(tauriFetch).mock.calls.filter((c) => String(c[0]).includes("/myself"))).toHaveLength(1);

    // Cached hit — no new network
    await loadTrackerSessionMetadata("acc-1");
    expect(vi.mocked(tauriFetch).mock.calls.filter((c) => String(c[0]).includes("/myself"))).toHaveLength(1);
  });

  it("force refresh reloads metadata after cooldown clear", async () => {
    vi.mocked(tauriFetch).mockImplementation(async (url: string) => {
      if (String(url).includes("/myself")) return jsonOk({ login: "user" });
      if (String(url).includes("/queues")) return jsonOk([]);
      if (String(url).includes("/statuses")) return jsonOk([]);
      if (String(url).includes("/priorities")) return jsonOk([]);
      throw new Error(`unexpected ${url}`);
    });

    await loadTrackerSessionMetadata("acc-1");
    await loadTrackerSessionMetadata("acc-1", { force: true });
    expect(vi.mocked(tauriFetch).mock.calls.filter((c) => String(c[0]).includes("/myself"))).toHaveLength(2);
  });
});
