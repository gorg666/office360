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
  delete (window as Window & { __o360IsolationNativeGen?: number }).__o360IsolationNativeGen;
  delete document.documentElement.dataset.o360TelemostSurface;
  delete document.documentElement.dataset.o360IsolationGeneration;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(HTMLElement.prototype, "innerText", { configurable: true, get() { return this.textContent ?? ""; } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
    const api = (window as Window & {
      __o360TelemostIsolation?: {
        hideStandaloneChrome: unknown;
        expandMeetingSurface: unknown;
        observeTelemostSpaChanges: unknown;
        applyOffice360TelemostLayout: unknown;
      };
    }).__o360TelemostIsolation;
    expect(api?.hideStandaloneChrome).toEqual(expect.any(Function));
    expect(api?.expandMeetingSurface).toEqual(expect.any(Function));
    expect(api?.observeTelemostSpaChanges).toEqual(expect.any(Function));
    expect(api?.applyOffice360TelemostLayout).toEqual(expect.any(Function));
    expect(document.getElementById("o360-telemost-isolation-style")?.textContent).not.toContain("justify-content:center");
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

  it("starts from script eval without OnLoadEnd", async () => {
    setMeetingRoute();
    document.body.innerHTML = `<main><button id="join">Подключиться</button></main>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(40, 40, 160, 44));
    eval(SCRIPT);
    await Promise.resolve();
    expect(document.documentElement.dataset.o360TelemostSurface).toBe("isolated");
  });

  it("adopts a newer navigation generation and ignores a stale one", async () => {
    setMeetingRoute();
    document.body.innerHTML = `<main><button id="join">Подключиться</button></main>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(40, 40, 160, 44));
    (window as Window & { __o360IsolationNativeGen?: number }).__o360IsolationNativeGen = 1;
    eval(SCRIPT);
    await Promise.resolve();
    const api = (window as Window & { __o360TelemostIsolation: { generation: () => number; adoptGeneration: (n: number) => void } }).__o360TelemostIsolation;
    expect(api.generation()).toBe(1);
    api.adoptGeneration(4);
    expect(api.generation()).toBe(4);
    api.adoptGeneration(2);
    expect(api.generation()).toBe(4);
    expect(document.querySelectorAll("#o360-telemost-isolation-style")).toHaveLength(1);
  });

  it("treats a later eval as LoadURL reuse with a new generation", async () => {
    setMeetingRoute();
    document.body.innerHTML = `<main><button id="join">Подключиться</button></main>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(40, 40, 160, 44));
    (window as Window & { __o360IsolationNativeGen?: number }).__o360IsolationNativeGen = 1;
    eval(SCRIPT);
    await Promise.resolve();
    (window as Window & { __o360IsolationNativeGen?: number }).__o360IsolationNativeGen = 2;
    eval(SCRIPT);
    await Promise.resolve();
    const api = (window as Window & { __o360TelemostIsolation: { generation: () => number } }).__o360TelemostIsolation;
    expect(api.generation()).toBe(2);
    expect(document.documentElement.dataset.o360IsolationGeneration).toBe("2");
  });

  it("does not inject on an unrelated URL", () => {
    setMeetingRoute("/mail");
    document.body.innerHTML = `<button>Продолжить в браузере</button>`;
    eval(SCRIPT);
    expect((window as Window & { __o360TelemostIsolation?: unknown }).__o360TelemostIsolation).toBeUndefined();
  });

  it("removes the Telemost continue-in-browser interstitial and keeps generic dialogs", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    setMeetingRoute();
    document.body.innerHTML = `
      <div>
        <div id="interstitial" role="dialog">
          <h2>Вы подключаетесь к видеовстрече</h2>
          <button id="continue">Продолжить в браузере</button>
        </div>
        <div id="settings" role="dialog"><p>Настройки встречи</p><button id="close">Закрыть</button></div>
        <main><button id="join">Подключиться</button><button id="mic">Микрофон</button></main>
      </div>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.id === "interstitial") return rect(400, 200, 480, 320);
      return rect(20, 20, 240, 48);
    });
    eval(SCRIPT);
    await Promise.resolve();
    expect(document.querySelector("#interstitial")?.className).toContain("o360-telemost-shell-hidden");
    expect(document.querySelector("#settings")?.className).not.toContain("o360-telemost-shell-hidden");
    expect(document.querySelector("#join")?.className).not.toContain("o360-telemost-shell-hidden");
    expect(document.querySelector("#mic")?.className).not.toContain("o360-telemost-shell-hidden");
  });

  it("clicks continue-in-browser instead of hiding when meeting surface is not ready yet", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    setMeetingRoute();
    document.body.innerHTML = `
      <div id="interstitial" role="dialog">
        <h2>Вы подключаетесь к видеовстрече</h2>
        <button id="continue">Продолжить в браузере</button>
      </div>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.id === "interstitial") return rect(400, 200, 480, 320);
      return rect(420, 360, 200, 44);
    });
    const continueBtn = document.querySelector("#continue") as HTMLButtonElement;
    const click = vi.spyOn(continueBtn, "click");
    eval(SCRIPT);
    await Promise.resolve();
    await Promise.resolve();
    expect(click).toHaveBeenCalled();
    expect(document.querySelector("#interstitial")?.className).not.toContain("o360-telemost-shell-hidden");
    expect(document.documentElement.dataset.o360TelemostSurface).toBeUndefined();
  });

  it("keeps a camera/mic permission dialog", async () => {
    setMeetingRoute();
    document.body.innerHTML = `
      <div id="permission" role="dialog" aria-modal="true">
        <p>Разрешить камеру и микрофон?</p>
        <button id="allow">Разрешить</button>
      </div>
      <main><button id="join">Подключиться</button></main>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(20, 20, 240, 48));
    eval(SCRIPT);
    await Promise.resolve();
    expect(document.querySelector("#permission")?.className).not.toContain("o360-telemost-shell-hidden");
    expect(document.querySelector("#allow")?.className).not.toContain("o360-telemost-shell-hidden");
  });

  it("keeps a Passport login surface", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    setMeetingRoute();
    document.body.innerHTML = `
      <form id="passport"><label>Пароль</label><input type="password"/><button id="login">Войти</button></form>
      <div id="interstitial" role="dialog"><h2>Вы подключаетесь к видеовстрече</h2><button>Продолжить в браузере</button></div>
      <main><button id="join">Подключиться</button></main>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.id === "interstitial") return rect(400, 200, 480, 320);
      return rect(20, 20, 240, 48);
    });
    eval(SCRIPT);
    await Promise.resolve();
    expect(document.querySelector("#passport")?.className).not.toContain("o360-telemost-shell-hidden");
    expect(document.querySelector("#login")?.className).not.toContain("o360-telemost-shell-hidden");
    expect(document.querySelector("#interstitial")?.className).toContain("o360-telemost-shell-hidden");
  });

  it("disconnects the MutationObserver after success and on timeout", async () => {
    vi.useFakeTimers();
    const disconnect = vi.fn();
    const observe = vi.fn();
    const Observer = vi.fn(function (this: { observe: unknown; disconnect: unknown }, callback: MutationCallback) {
      void callback;
      this.observe = observe;
      this.disconnect = disconnect;
      return this;
    });
    vi.stubGlobal("MutationObserver", Observer);
    setMeetingRoute();
    document.body.innerHTML = `<main><p>Loading</p></main>`;
    eval(SCRIPT);
    expect(Observer).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(12000);
    expect(disconnect).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("keeps the MutationObserver after early isolation until timeout", async () => {
    vi.useFakeTimers();
    const disconnect = vi.fn();
    const observe = vi.fn();
    const Observer = vi.fn(function (this: { observe: unknown; disconnect: unknown }) {
      this.observe = observe;
      this.disconnect = disconnect;
      return this;
    });
    vi.stubGlobal("MutationObserver", Observer);
    setMeetingRoute();
    document.body.innerHTML = `<main><button id="mic">Микрофон</button></main>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(40, 40, 160, 44));
    eval(SCRIPT);
    await Promise.resolve();
    const api = (window as Window & { __o360TelemostIsolation: { observerActive: () => boolean } }).__o360TelemostIsolation;
    expect(document.documentElement.dataset.o360TelemostSurface).toBe("isolated");
    expect(api.observerActive()).toBe(true);
    expect(disconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(12000);
    expect(disconnect).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("never hides the app root or a video/meeting-control ancestor", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    setMeetingRoute();
    document.body.innerHTML = `
      <div id="root">
        <video id="cam"></video>
        <button id="cta">Продолжить в браузере</button>
        <button id="join">Подключиться</button>
        <button id="mic">Микрофон</button>
      </div>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.id === "root") return rect(0, 0, 1400, 900);
      return rect(40, 40, 200, 48);
    });
    eval(SCRIPT);
    await Promise.resolve();
    expect(document.querySelector("#root")?.className).not.toContain("o360-telemost-shell-hidden");
    expect(document.querySelector("#cam")?.className).not.toContain("o360-telemost-shell-hidden");
    expect(document.querySelector("#join")?.className).not.toContain("o360-telemost-shell-hidden");
    expect(document.querySelector("#mic")?.className).not.toContain("o360-telemost-shell-hidden");
  });

  it("layout rules do not force a black page background", async () => {
    setMeetingRoute();
    document.body.innerHTML = `<main><button id="join">Подключиться</button><button id="mic">Микрофон</button></main>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(40, 40, 160, 44));
    eval(SCRIPT);
    await Promise.resolve();
    const css = document.getElementById("o360-telemost-isolation-style")?.textContent ?? "";
    expect(document.documentElement.dataset.o360TelemostSurface).toBe("isolated");
    expect(css).not.toMatch(/background\s*:/);
    expect(css).not.toContain("*{");
  });

  it("hides only the compact interstitial card, not a near-fullscreen shell", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    setMeetingRoute();
    document.body.innerHTML = `
      <div id="shell">
        <div id="interstitial" role="dialog">
          <h2>Вы подключаетесь к видеовстрече</h2>
          <button id="continue">Продолжить в браузере</button>
        </div>
        <main><button id="join">Подключиться</button><button id="mic">Микрофон</button></main>
      </div>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.id === "shell") return rect(0, 0, 1400, 900);
      if (this.id === "interstitial") return rect(400, 200, 480, 320);
      return rect(420, 360, 200, 44);
    });
    eval(SCRIPT);
    await Promise.resolve();
    expect(document.querySelector("#interstitial")?.className).toContain("o360-telemost-shell-hidden");
    expect(document.querySelector("#shell")?.className).not.toContain("o360-telemost-shell-hidden");
    expect(document.querySelector("#join")?.className).not.toContain("o360-telemost-shell-hidden");
  });
});
