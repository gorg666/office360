// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCRIPT = readFileSync(resolve(process.cwd(), "src-tauri/src/telemost_official_create_click.js"), "utf8");

type CreateApi = {
  events: string[];
  clicked: number;
  authState: string;
  identity: { uid: string; login: string };
  stop: () => void;
  kick: () => void;
};

function api(): CreateApi | undefined {
  return (window as Window & { __o360TelemostOfficialCreate?: CreateApi }).__o360TelemostOfficialCreate;
}

function setLocation(hostname: string, pathname: string, search = ""): void {
  vi.stubGlobal("location", {
    hostname,
    pathname,
    search,
    href: `https://${hostname}${pathname}${search}`,
    protocol: "https:",
    host: hostname,
  });
}

function clickTracker(id: string): number[] {
  const clicks: number[] = [];
  document.getElementById(id)?.addEventListener("click", () => clicks.push(1));
  return clicks;
}

function preload(user: unknown): string {
  return `<script type="application/json" id="preloaded-state">${JSON.stringify({ user })}</script>`;
}

function mockUsersMe(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/telemost_front/v2/telemost/users/me")) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  delete (window as Window & { __o360TelemostOfficialCreate?: unknown }).__o360TelemostOfficialCreate;
  delete (window as Window & { __o360TelemostUsersMeHooked?: unknown }).__o360TelemostUsersMeHooked;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mockUsersMe(404, {});
  Object.defineProperty(HTMLElement.prototype, "innerText", { configurable: true, get() { return this.textContent ?? ""; } });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  setLocation("telemost.yandex.ru", "/");
});

afterEach(() => {
  api()?.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  Object.defineProperty(document, "readyState", { configurable: true, get: () => "complete" });
});

describe("official Telemost HOME create click", () => {
  it("clicks once when preloaded-state has a Telemost uid", async () => {
    document.body.innerHTML = `${preload({ uid: "42", login: "korotkov.g" })}<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([1]);
    expect(api()?.clicked).toBe(1);
    expect(api()?.authState).toBe("AUTHENTICATED");
    expect(api()?.identity).toEqual({ uid: "42", login: "korotkov.g" });
    expect(api()?.events.some((event) => event.startsWith("auth=AUTHENTICATED"))).toBe(true);
  });

  it("clicks once when users/me returns a uid after hydration", async () => {
    document.body.innerHTML = `${preload(null)}<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    mockUsersMe(200, { uid: "99", login: "person" });
    eval(SCRIPT);
    await vi.waitFor(() => expect(clicks).toEqual([1]));
    expect(api()?.authState).toBe("AUTHENTICATED");
    expect(api()?.identity.uid).toBe("99");
  });

  it("does not click when the server-backed user is anonymous", async () => {
    document.body.innerHTML = `${preload(null)}<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    await vi.waitFor(() => expect(api()?.events.some((event) => event.startsWith("auth=REQUIRED"))).toBe(true));
    expect(clicks).toEqual([]);
    expect(api()?.clicked).toBe(0);
    expect(api()?.authState).toBe("REQUIRED");
  });

  it("does not click while users/me is still hydrating", () => {
    document.body.innerHTML = `${preload(null)}<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    eval(SCRIPT);
    expect(clicks).toEqual([]);
    expect(api()?.clicked).toBe(0);
    expect(api()?.authState).toBe("CHECKING");
  });

  it("does not treat a generic avatar CDN as authenticated", async () => {
    document.body.innerHTML = `${preload(null)}<img src="https://avatars.yandex.net/get-yapic/1"><button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    await vi.waitFor(() => expect(api()?.authState).toBe("REQUIRED"));
    expect(clicks).toEqual([]);
  });

  it("does not treat a generic id.yandex link as authenticated", async () => {
    document.body.innerHTML = `${preload(null)}<a href="https://id.yandex.ru">Профиль</a><button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    await vi.waitFor(() => expect(api()?.authState).toBe("REQUIRED"));
    expect(clicks).toEqual([]);
  });

  it("re-evaluates the same URL when preloaded user becomes authenticated", async () => {
    document.body.innerHTML = `${preload(null)}<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    await vi.waitFor(() => expect(api()?.authState).toBe("REQUIRED"));
    expect(clicks).toEqual([]);
    document.getElementById("preloaded-state")!.textContent = JSON.stringify({ user: { uid: "7", login: "a" } });
    api()?.kick();
    expect(clicks).toEqual([1]);
    expect(api()?.authState).toBe("AUTHENTICATED");
  });

  it("retries after a users/me attribute/state change via kick", async () => {
    document.body.innerHTML = `${preload(null)}<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    await vi.waitFor(() => expect(api()?.authState).toBe("REQUIRED"));
    mockUsersMe(200, { uid: "55" });
    api()?.kick();
    await vi.waitFor(() => expect(clicks).toEqual([1]));
  });

  it("does not mark clicked when the official CTA is disabled", () => {
    document.body.innerHTML = `${preload({ uid: "1" })}<button id="create" disabled>Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([]);
    expect(api()?.clicked).toBe(0);
    expect(api()?.authState).toBe("AUTHENTICATED");
  });

  it("clicks at most once if the HOME DOM rerenders after the first click", () => {
    document.body.innerHTML = `${preload({ uid: "1" })}<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([1]);
    document.body.innerHTML = `${preload({ uid: "1" })}<button id="create2">Создать видеовстречу</button>`;
    const second = clickTracker("create2");
    document.body.append(document.createElement("span"));
    expect(second).toEqual([]);
    expect(api()?.clicked).toBe(1);
  });

  it("recovers from TIMEOUT on the same page when users/me later authenticates", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `${preload(null)}<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    eval(SCRIPT);
    await vi.advanceTimersByTimeAsync(12000);
    expect(api()?.authState).toBe("TIMEOUT");
    expect(clicks).toEqual([]);
    vi.useRealTimers();
    mockUsersMe(200, { uid: "88", login: "korotkov.g@office-360.ru" });
    api()?.kick();
    await vi.waitFor(() => expect(clicks).toEqual([1]));
    expect(api()?.authState).toBe("AUTHENTICATED");
  });

  it("fails closed on timeout instead of clicking as guest", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `${preload(null)}<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    eval(SCRIPT);
    expect(api()?.authState).toBe("CHECKING");
    await vi.advanceTimersByTimeAsync(12000);
    expect(clicks).toEqual([]);
    expect(api()?.clicked).toBe(0);
    expect(api()?.authState).toBe("TIMEOUT");
  });

  it("does not install CREATE/auth automation on PREJOIN/MEETING join URLs", () => {
    setLocation("telemost.yandex.ru", "/j/123456789");
    document.body.innerHTML = `${preload({ uid: "1" })}<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    const title = vi.spyOn(document, "title", "set");
    const usersMe = mockUsersMe(200, { uid: "1" });
    eval(SCRIPT);
    expect(clicks).toEqual([]);
    expect(api()).toBeUndefined();
    expect(usersMe).toHaveBeenCalled();
    expect(title).not.toHaveBeenCalled();
  });

  it("beacons REQUIRED from a one-shot /j/ cookie probe without CREATE observers", async () => {
    setLocation("telemost.yandex.ru", "/j/123456789");
    document.body.innerHTML = `${preload({ uid: "1" })}<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    mockUsersMe(401, {});
    eval(SCRIPT);
    expect(api()).toBeUndefined();
    await vi.waitFor(() => expect(document.title).toContain("auth=REQUIRED;surface=join"));
    expect(clicks).toEqual([]);
  });

  it("probes current-user on auth-check HOME without clicking CREATE", async () => {
    setLocation("telemost.360.yandex.ru", "/", "?office360-auth-check=1");
    document.body.innerHTML = `${preload({ uid: "77", login: "korotkov.g@office-360.ru" })}<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([]);
    expect(api()?.clicked).toBe(0);
    expect(api()?.authState).toBe("AUTHENTICATED");
    expect(api()?.events.some((event) => event.includes("surface=check"))).toBe(true);
    expect(api()?.events).toContain("state=AUTH_CHECK");
  });

  it("probes users/me on auth-check without waiting for HOME SPA complete", async () => {
    setLocation("telemost.360.yandex.ru", "/", "?office360-auth-check=1");
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });
    document.body.innerHTML = "<div>loading shell</div>";
    const usersMe = mockUsersMe(200, { uid: "9", login: "person@example.test" });
    eval(SCRIPT);
    await vi.waitFor(() => expect(usersMe).toHaveBeenCalled());
    await vi.waitFor(() => expect(api()?.authState).toBe("AUTHENTICATED"));
    expect(api()?.clicked).toBe(0);
  });

  it("does not click when PREJOIN join chrome is present", () => {
    document.body.innerHTML = `${preload({ uid: "1" })}<button id="create">Создать видеовстречу</button><button>Присоединиться</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([]);
    expect(api()?.events).toContain("skip PREJOIN/MEETING chrome");
  });

  it("does not run on Passport", () => {
    setLocation("passport.yandex.ru", "/auth");
    document.body.innerHTML = `${preload({ uid: "1" })}<button id="create">Создать видеовстречу</button>`;
    eval(SCRIPT);
    expect(api()).toBeUndefined();
  });

  it("does not click a generic Создать control even when authenticated", () => {
    document.body.innerHTML = `${preload({ uid: "1" })}<button id="generic">Создать</button>`;
    const generic = clickTracker("generic");
    eval(SCRIPT);
    expect(generic).toEqual([]);
    expect(api()?.clicked).toBe(0);
  });

  it("resets click eligibility for a new HOME epoch after Passport and clicks once more", () => {
    document.body.innerHTML = `${preload({ uid: "1" })}<button id="create">Создать видеовстречу</button>`;
    const first = clickTracker("create");
    eval(SCRIPT);
    expect(first).toEqual([1]);
    setLocation("passport.yandex.ru", "/auth");
    eval(SCRIPT);
    expect(first).toEqual([1]);
    setLocation("telemost.yandex.ru", "/", "?from_passport=1");
    document.body.innerHTML = `${preload({ uid: "1" })}<button id="create2">Создать видеовстречу</button>`;
    const second = clickTracker("create2");
    eval(SCRIPT);
    expect(second).toEqual([1]);
    expect(api()?.events).toContain("epoch reset");
    expect(api()?.clicked).toBe(1);
  });
});
