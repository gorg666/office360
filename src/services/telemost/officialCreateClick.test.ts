// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCRIPT = readFileSync(resolve(process.cwd(), "src-tauri/src/telemost_official_create_click.js"), "utf8");

type CreateApi = { events: string[]; clicked: number; stop: () => void; kick: () => void };

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

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  delete (window as Window & { __o360TelemostOfficialCreate?: unknown }).__o360TelemostOfficialCreate;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(HTMLElement.prototype, "innerText", { configurable: true, get() { return this.textContent ?? ""; } });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  setLocation("telemost.yandex.ru", "/");
});

afterEach(() => {
  api()?.stop();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  Object.defineProperty(document, "readyState", { configurable: true, get: () => "complete" });
});

describe("official Telemost HOME create click", () => {
  it("clicks the exact official create CTA once on HOME even with a zero layout rect", () => {
    document.body.innerHTML = `<button id="create">Создать видеовстречу</button><button>Запланировать</button><button>Подключиться</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([1]);
    expect(api()?.clicked).toBe(1);
    expect(api()?.events).toContain("state=HOME");
    expect(api()?.events).toContain("official CTA matched");
    expect(api()?.events).toContain("clicked once");
  });

  it("does not treat a zero layout rect as a reason to skip the official CTA", () => {
    document.body.innerHTML = `<button id="create" style="width:0;height:0">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([1]);
  });

  it("does not click a display:none official CTA", () => {
    document.body.innerHTML = `<button id="create" style="display:none">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([]);
    expect(api()?.clicked).toBe(0);
  });

  it("does not click a generic Создать or Office360 Новая видеовстреча control", () => {
    document.body.innerHTML = `<button id="generic">Создать</button><button id="office">Новая видеовстреча</button>`;
    const generic = clickTracker("generic");
    const office = clickTracker("office");
    eval(SCRIPT);
    expect(generic).toEqual([]);
    expect(office).toEqual([]);
    expect(api()?.clicked).toBe(0);
  });

  it("does not auto-click when two official create CTAs are present", () => {
    document.body.innerHTML = `<button id="a">Создать видеовстречу</button><button id="b">Создать видеовстречу</button>`;
    const a = clickTracker("a");
    const b = clickTracker("b");
    eval(SCRIPT);
    expect(a).toEqual([]);
    expect(b).toEqual([]);
    expect(api()?.clicked).toBe(0);
    expect(api()?.events).toContain("ambiguous CTA");
  });

  it("does not click on PREJOIN/MEETING join URLs", () => {
    setLocation("telemost.yandex.ru", "/j/123456789");
    document.body.innerHTML = `<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([]);
    expect(api()).toBeUndefined();
  });

  it("does not click when PREJOIN join chrome is present", () => {
    document.body.innerHTML = `<button id="create">Создать видеовстречу</button><button>Присоединиться</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([]);
    expect(api()?.events).toContain("skip PREJOIN/MEETING chrome");
  });

  it("does not click when MEETING leave chrome is present", () => {
    document.body.innerHTML = `<button id="create">Создать видеовстречу</button><button>Покинуть</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([]);
    expect(api()?.events).toContain("skip PREJOIN/MEETING chrome");
  });

  it("does not run on Passport", () => {
    setLocation("passport.yandex.ru", "/auth");
    document.body.innerHTML = `<button id="create">Создать видеовстречу</button>`;
    eval(SCRIPT);
    expect(api()).toBeUndefined();
  });

  it("does not run on a non-Telemost host", () => {
    setLocation("evil.example", "/");
    document.body.innerHTML = `<button id="create">Создать видеовстречу</button>`;
    eval(SCRIPT);
    expect(api()).toBeUndefined();
  });

  it("clicks at most once if the HOME DOM rerenders after the first click", () => {
    document.body.innerHTML = `<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([1]);
    document.body.innerHTML = `<button id="create2">Создать видеовстречу</button>`;
    const second = clickTracker("create2");
    document.body.append(document.createElement("span"));
    expect(second).toEqual([]);
    expect(api()?.clicked).toBe(1);
    expect(clicks).toEqual([1]);
  });

  it("stops retrying after /j/ is captured", async () => {
    document.body.innerHTML = `<div></div>`;
    eval(SCRIPT);
    expect(api()?.clicked).toBe(0);
    setLocation("telemost.yandex.ru", "/j/999");
    document.body.innerHTML = `<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    document.body.append(document.createElement("span"));
    await vi.waitFor(() => expect(api()?.events).toContain("/j/ captured"));
    expect(clicks).toEqual([]);
    expect(api()?.clicked).toBe(0);
  });

  it("does not click until the document is complete", () => {
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });
    document.body.innerHTML = `<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([]);
    expect(api()?.clicked).toBe(0);
  });

  it("clicks once on re-eval kick after the document becomes complete", () => {
    let readyState = "loading";
    Object.defineProperty(document, "readyState", { configurable: true, get: () => readyState });
    document.body.innerHTML = `<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([]);
    readyState = "complete";
    eval(SCRIPT);
    expect(clicks).toEqual([1]);
    expect(api()?.clicked).toBe(1);
  });

  it("does not click on Passport even if an official create CTA exists", () => {
    setLocation("passport.yandex.ru", "/auth");
    document.body.innerHTML = `<button id="create">Создать видеовстречу</button>`;
    const clicks = clickTracker("create");
    eval(SCRIPT);
    expect(clicks).toEqual([]);
    expect(api()).toBeUndefined();
  });

  it("resets click eligibility for a new HOME epoch after Passport and clicks once more", () => {
    document.body.innerHTML = `<button id="create">Создать видеовстречу</button>`;
    const first = clickTracker("create");
    eval(SCRIPT);
    expect(first).toEqual([1]);
    setLocation("passport.yandex.ru", "/auth");
    eval(SCRIPT);
    expect(first).toEqual([1]);
    setLocation("telemost.yandex.ru", "/", "?from_passport=1");
    document.body.innerHTML = `<button id="create2">Создать видеовстречу</button>`;
    const second = clickTracker("create2");
    eval(SCRIPT);
    expect(second).toEqual([1]);
    expect(api()?.events).toContain("epoch reset");
    expect(api()?.clicked).toBe(1);
  });
});
