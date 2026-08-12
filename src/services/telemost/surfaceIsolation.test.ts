// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCRIPT = readFileSync(resolve(process.cwd(), "src-tauri/src/telemost_surface_isolation.js"), "utf8");

function setMeetingRoute(path = "/j/123"): void {
  history.replaceState({}, "", path);
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => { callback(0); return 1; }) as typeof requestAnimationFrame;
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  delete (window as Window & { __o360TelemostIsolation?: unknown }).__o360TelemostIsolation;
  delete document.documentElement.dataset.o360TelemostSurface;
  vi.restoreAllMocks();
  Object.defineProperty(HTMLElement.prototype, "innerText", { configurable: true, get() { return this.textContent ?? ""; } });
});

afterEach(() => {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => { callback(0); return 1; }) as typeof requestAnimationFrame;
  history.replaceState({}, "", "/");
  document.body.replaceChildren();
});

describe("Telemost meeting surface isolation", () => {
  it("does not activate on create or Passport routes", () => {
    for (const path of ["/?browser-auto-create=1", "/auth"]) {
      setMeetingRoute(path); eval(SCRIPT);
      expect((window as Window & { __o360TelemostIsolation?: unknown }).__o360TelemostIsolation).toBeUndefined();
    }
  });

  it("hides the proven global shell while preserving meeting controls", async () => {
    setMeetingRoute();
    document.body.innerHTML = `
      <div>
        <div>
          <div id="rail" data-testid="orb-global-bar" data-orb-global-bar="true" class="GlobalBarRoot_x globalBar_y">
            <a aria-label="Почта">Почта</a><a>Диск</a><a>Календарь</a><a>Телемост</a><a>Доски</a>
            <button aria-label="Настройки">Настройки</button>
          </div>
          <div>
            <a id="tariff">Тарифы для бизнеса</a>
            <main><button id="join">Подключиться</button></main>
            <footer id="footer">Поддержка Скачать на Mac</footer>
          </div>
        </div>
      </div>`;
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.id === "rail" || this.getAttribute("data-testid") === "orb-global-bar") return rect(0, 0, 64, 900);
      if (this.id === "footer") return rect(0, 840, 1400, 60);
      if (this.id === "tariff") return rect(1200, 20, 160, 36);
      if (this.id === "join") return rect(500, 400, 160, 44);
      return rect(120, 100, 800, 600);
    });
    eval(SCRIPT);
    if (document.readyState === "loading") document.dispatchEvent(new Event("DOMContentLoaded"));
    await Promise.resolve();
    expect(document.querySelector("#rail")?.className).toContain("o360-telemost-shell-hidden");
    expect(document.querySelector("#footer")?.className).toContain("o360-telemost-shell-hidden");
    expect(document.querySelector("#tariff")?.className).toContain("o360-telemost-shell-hidden");
    expect(document.querySelector("#join")?.className).not.toContain("o360-telemost-shell-hidden");
    expect(document.documentElement.dataset.o360TelemostSurface).toBe("isolated");
  });

  it("does not treat GlobalBar settings as meeting-ready", async () => {
    setMeetingRoute();
    document.body.innerHTML = `<div data-testid="orb-global-bar" data-orb-global-bar="true"><button aria-label="Настройки">Настройки</button></div><main><p>Loading</p></main>`;
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("data-testid") === "orb-global-bar") return rect(0, 0, 64, 900);
      return rect(100, 100, 200, 40);
    });
    eval(SCRIPT);
    if (document.readyState === "loading") document.dispatchEvent(new Event("DOMContentLoaded"));
    await Promise.resolve();
    expect(document.documentElement.dataset.o360TelemostSurface).toBeUndefined();
    expect(document.querySelector(".o360-telemost-shell-hidden")).toBeNull();
  });

  it("is idempotent and leaves unknown meeting DOM untouched", () => {
    setMeetingRoute();
    document.body.innerHTML = "<main><p>Unknown content</p></main>";
    eval(SCRIPT); eval(SCRIPT);
    expect(document.querySelectorAll("#o360-telemost-isolation-style")).toHaveLength(0);
    expect(document.querySelector(".o360-telemost-shell-hidden")).toBeNull();
  });
});
