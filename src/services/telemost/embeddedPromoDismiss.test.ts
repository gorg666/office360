// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCRIPT = readFileSync(resolve(process.cwd(), "src-tauri/src/telemost_embedded_promo_dismiss.js"), "utf8");

type PromoApi = { events: string[]; clicked: number; stop: () => void };

function api(): PromoApi | undefined {
  return (window as Window & { __o360TelemostPromoDismiss?: PromoApi }).__o360TelemostPromoDismiss;
}

function setLocation(hostname: string, pathname: string): void {
  vi.stubGlobal("location", {
    hostname,
    pathname,
    href: `https://${hostname}${pathname}`,
    protocol: "https:",
    host: hostname,
  });
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function promoHtml(id = "promo"): string {
  return `<div id="${id}" role="dialog">
    <h2>Вы подключаетесь к видеовстрече</h2>
    <button id="${id}-cta">Продолжить в браузере</button>
  </div>`;
}

function mockCompactPromo(ids: string[] = ["promo"]): void {
  Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (ids.some((id) => this.id === id || this.id === `${id}-cta` || this.closest?.(`#${id}`))) {
      if (this.id.endsWith("-cta")) return rect(520, 360, 200, 44);
      if (ids.includes(this.id)) return rect(400, 200, 480, 320);
      return rect(400, 200, 480, 320);
    }
    return rect(0, 0, 0, 0);
  });
}

function snapshotDom(): { htmlClass: string; bodyClass: string; styleCount: number; markup: string } {
  return {
    htmlClass: document.documentElement.className,
    bodyClass: document.body.className,
    styleCount: document.querySelectorAll("style").length,
    markup: document.documentElement.outerHTML,
  };
}

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  delete (window as Window & { __o360TelemostPromoDismiss?: unknown }).__o360TelemostPromoDismiss;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(HTMLElement.prototype, "innerText", { configurable: true, get() { return this.textContent ?? ""; } });
  setLocation("telemost.yandex.ru", "/j/13919900334569");
});

afterEach(() => {
  api()?.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("Telemost embedded promo-only dismiss", () => {
  it("clicks a confirmed native-app promo CTA exactly once", () => {
    document.body.innerHTML = promoHtml();
    mockCompactPromo();
    const clicks: number[] = [];
    document.getElementById("promo-cta")?.addEventListener("click", () => clicks.push(1));
    eval(SCRIPT);
    expect(clicks).toEqual([1]);
    expect(api()?.clicked).toBe(1);
    expect(api()?.events).toEqual([
      "PROMO DISMISS SCRIPT READY",
      "PROMO DETECTED",
      "PROMO CTA DETECTED",
      "PROMO CLICKED",
    ]);
    document.getElementById("promo")?.append(" spam");
    document.getElementById("promo-cta")?.dispatchEvent(new Event("click"));
    expect(api()?.clicked).toBe(1);
  });

  it("clicks a delayed SPA-mounted promo once", async () => {
    mockCompactPromo();
    eval(SCRIPT);
    expect(api()?.clicked).toBe(0);
    document.body.innerHTML = promoHtml();
    await vi.waitFor(() => expect(api()?.clicked).toBe(1));
    document.body.append("mutation-spam");
    document.getElementById("promo")?.setAttribute("data-x", "1");
    await Promise.resolve();
    expect(api()?.clicked).toBe(1);
  });

  it("handles another confirmed promo after a fresh document load", () => {
    document.body.innerHTML = promoHtml("first");
    mockCompactPromo(["first"]);
    eval(SCRIPT);
    expect(api()?.clicked).toBe(1);
    api()?.stop();
    delete (window as Window & { __o360TelemostPromoDismiss?: unknown }).__o360TelemostPromoDismiss;
    document.body.innerHTML = promoHtml("second");
    mockCompactPromo(["second"]);
    eval(SCRIPT);
    expect(api()?.clicked).toBe(1);
    expect(api()?.events).toContain("PROMO CLICKED");
  });

  it("does not click a generic continue-in-browser control outside a promo", () => {
    document.body.innerHTML = `<nav><button id="generic">Продолжить в браузере</button></nav>`;
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.id === "generic" || this.tagName === "NAV") return rect(0, 0, 1400, 80);
      return rect(0, 0, 0, 0);
    });
    const clicks: number[] = [];
    document.getElementById("generic")?.addEventListener("click", () => clicks.push(1));
    eval(SCRIPT);
    expect(clicks).toEqual([]);
    expect(api()?.clicked).toBe(0);
  });

  it("does not activate on Passport or OAuth hosts", () => {
    for (const hostname of ["passport.yandex.ru", "passport.yandex.com", "oauth.yandex.ru", "oauth.yandex.com"]) {
      delete (window as Window & { __o360TelemostPromoDismiss?: unknown }).__o360TelemostPromoDismiss;
      setLocation(hostname, "/auth");
      document.body.innerHTML = promoHtml();
      mockCompactPromo();
      eval(SCRIPT);
      expect(api()).toBeUndefined();
    }
  });

  it("does not click camera or microphone permission dialogs", () => {
    document.body.innerHTML = `
      <div id="cam" role="dialog"><p>Разрешить камеру</p><button id="cam-cta">Продолжить в браузере</button></div>
      <div id="mic" role="dialog"><p>Разрешить микрофон</p><button id="mic-cta">Продолжить в браузере</button></div>`;
    mockCompactPromo(["cam", "mic"]);
    const clicks: string[] = [];
    document.getElementById("cam-cta")?.addEventListener("click", () => clicks.push("cam"));
    document.getElementById("mic-cta")?.addEventListener("click", () => clicks.push("mic"));
    eval(SCRIPT);
    expect(clicks).toEqual([]);
  });

  it("does not click normal prejoin controls", () => {
    document.body.innerHTML = `<main>
      <button id="camera">Камера</button>
      <button id="mic">Микрофон</button>
      <button id="join">Подключиться</button>
    </main>`;
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect(400, 300, 160, 44));
    const clicks: string[] = [];
    for (const id of ["camera", "mic", "join"]) {
      document.getElementById(id)?.addEventListener("click", () => clicks.push(id));
    }
    eval(SCRIPT);
    expect(clicks).toEqual([]);
  });

  it("does not click an arbitrary matching-text button without promo heading", () => {
    document.body.innerHTML = `<div id="card"><button id="cta">Продолжить в браузере</button></div>`;
    mockCompactPromo(["card"]);
    const clicks: number[] = [];
    document.getElementById("cta")?.addEventListener("click", () => clicks.push(1));
    eval(SCRIPT);
    expect(clicks).toEqual([]);
  });

  it("does not add CSS, class, or layout mutations and does not navigate", () => {
    document.body.innerHTML = promoHtml();
    mockCompactPromo();
    const href = window.location.href;
    const before = snapshotDom();
    eval(SCRIPT);
    const after = snapshotDom();
    expect(after.htmlClass).toBe(before.htmlClass);
    expect(after.bodyClass).toBe(before.bodyClass);
    expect(after.styleCount).toBe(before.styleCount);
    expect(document.getElementById("promo")?.className).toBe("");
    expect(window.location.href).toBe(href);
    expect(document.querySelector("[href^='telemost:']")).toBeNull();
  });
});
