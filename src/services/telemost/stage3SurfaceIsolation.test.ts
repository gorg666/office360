// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCRIPT = readFileSync(resolve(process.cwd(), "src-tauri/src/telemost_stage3_surface_isolation.js"), "utf8");

type IsolationApi = {
  state: string;
  hiddenCount: number;
  events: string[];
  observerActive: boolean;
  leaveWatchActive?: boolean;
  transitionPollActive?: boolean;
  lastApplyAt: number;
  applyCount?: number;
  apply: () => void;
  stop: () => void;
};

function api(): IsolationApi | undefined {
  return (window as Window & { __o360TelemostSurfaceIsolation?: IsolationApi }).__o360TelemostSurfaceIsolation;
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

function prejoinHtml(): string {
  return `
    <div id="rail" data-testid="orb-global-bar"><a>Почта</a><button aria-label="Настройки">Настройки</button></div>
    <a id="tariff">Тарифы для бизнеса</a>
    <main id="prejoin">
      <video id="preview"></video>
      <audio id="preview-audio"></audio>
      <canvas id="preview-canvas"></canvas>
      <input id="name" value="Test User" />
      <button id="camera">Камера</button>
      <button id="mic">Микрофон</button>
      <button id="settings">Настройки</button>
      <button id="join">Подключиться</button>
    </main>
    <footer id="footer">Поддержка Частые вопросы Скачать на MacOS Скачать на телефон</footer>`;
}

function meetingHtml(): string {
  return `
    <div id="rail" data-testid="orb-global-bar"><a>Почта</a></div>
    <a id="tariff">Тарифы для бизнеса</a>
    <main id="stage">
      <video id="remote"></video>
      <video id="local"></video>
      <div id="controls">
        <button id="mic">Микрофон</button>
        <button id="camera">Камера</button>
        <button id="participants">Участники</button>
        <button id="chat">Чат</button>
        <button id="reactions">Реакции</button>
        <button id="share">Поделиться экраном</button>
        <button id="settings">Настройки</button>
        <button id="leave">Выйти из встречи</button>
      </div>
    </main>
    <footer id="footer">Поддержка Частые вопросы Скачать на MacOS Скачать на телефон</footer>`;
}

function homeHtml(): string {
  return `
    <div id="rail" data-testid="orb-global-bar"><a>Почта</a></div>
    <a id="tariff">Тарифы для бизнеса</a>
    <main id="home">
      <button id="create">Создать видеовстречу</button>
    </main>
    <footer id="footer">Поддержка Частые вопросы Скачать на MacOS Скачать на телефон</footer>`;
}

function mockPrejoinGeometry(): void {
  Object.defineProperty(window, "innerWidth", { value: 1400, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.id === "rail" || this.getAttribute("data-testid") === "orb-global-bar") return rect(0, 0, 64, 900);
    if (this.id === "tariff") return rect(200, 12, 220, 32);
    if (this.id === "footer") return rect(0, 840, 1400, 60);
    if (this.id === "join" || this.id === "camera" || this.id === "mic" || this.id === "settings"
      || this.id === "participants" || this.id === "chat" || this.id === "reactions" || this.id === "share" || this.id === "leave"
      || this.id === "create") {
      return rect(500, 400, 160, 44);
    }
    if (this.id === "preview" || this.id === "preview-audio" || this.id === "preview-canvas" || this.id === "remote" || this.id === "local") {
      return rect(420, 120, 360, 200);
    }
    if (this.id === "prejoin" || this.id === "stage" || this.id === "controls" || this.id === "home") return rect(120, 80, 1100, 700);
    if (this.getAttribute("role") === "dialog") return rect(400, 200, 480, 280);
    return rect(120, 80, 400, 80);
  });
}

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  delete (window as Window & { __o360TelemostSurfaceIsolation?: unknown }).__o360TelemostSurfaceIsolation;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof requestAnimationFrame;
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get() { return this.textContent ?? ""; },
  });
  setLocation("telemost.yandex.ru", "/j/123");
});

afterEach(() => {
  api()?.stop();
  delete (window as Window & { __o360TelemostJoinClick?: unknown }).__o360TelemostJoinClick;
  delete (window as Window & { __o360TelemostJoinClickBound?: unknown }).__o360TelemostJoinClickBound;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.getElementById("o360-telemost-stage3-isolation-style")?.remove();
});

describe("Stage 3 Telemost surface isolation", () => {
  it("does not activate on Passport hosts", () => {
    for (const hostname of ["passport.yandex.ru", "passport.yandex.com"]) {
      delete (window as Window & { __o360TelemostSurfaceIsolation?: unknown }).__o360TelemostSurfaceIsolation;
      setLocation(hostname, "/auth");
      document.body.innerHTML = prejoinHtml();
      mockPrejoinGeometry();
      eval(SCRIPT);
      expect(api()).toBeUndefined();
      expect(document.querySelector("#rail")?.className).not.toContain("o360-telemost-hidden");
    }
  });

  it("does not activate on OAuth hosts", () => {
    for (const hostname of ["oauth.yandex.ru", "oauth.yandex.com"]) {
      delete (window as Window & { __o360TelemostSurfaceIsolation?: unknown }).__o360TelemostSurfaceIsolation;
      setLocation(hostname, "/authorize");
      document.body.innerHTML = prejoinHtml();
      mockPrejoinGeometry();
      eval(SCRIPT);
      expect(api()).toBeUndefined();
    }
  });

  it("does not hide HOME chrome", () => {
    setLocation("telemost.yandex.ru", "/");
    document.body.innerHTML = prejoinHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(api()?.state).toBe("HOME");
    expect(document.querySelector("#rail")?.className).not.toContain("o360-telemost-hidden");
    expect(document.querySelector("#tariff")?.className).not.toContain("o360-telemost-hidden");
    expect(document.querySelector("#footer")?.className).not.toContain("o360-telemost-hidden");
    expect(api()?.hiddenCount).toBe(0);
  });

  it("hides proven PREJOIN sidebar, tariff, and footer", () => {
    document.body.innerHTML = prejoinHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(api()?.state).toBe("PREJOIN");
    expect(document.querySelector("#rail")?.className).toContain("o360-telemost-hidden");
    expect(document.querySelector("#tariff")?.className).toContain("o360-telemost-hidden");
    expect(document.querySelector("#footer")?.className).toContain("o360-telemost-hidden");
    expect(api()?.events).toEqual(expect.arrayContaining(["hidden sidebar", "hidden tariff", "hidden footer"]));
  });

  it("leaves the PREJOIN content subtree untouched", () => {
    document.body.innerHTML = prejoinHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    for (const id of ["prejoin", "preview", "name", "camera", "mic", "settings", "join"]) {
      expect(document.getElementById(id)?.className).not.toContain("o360-telemost-hidden");
    }
  });

  it("is idempotent on repeated apply", () => {
    document.body.innerHTML = prejoinHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    const first = api()?.hiddenCount;
    const className = document.querySelector("#rail")?.className;
    api()?.apply();
    api()?.apply();
    expect(api()?.hiddenCount).toBe(first);
    expect(document.querySelector("#rail")?.className).toBe(className);
    expect(document.querySelectorAll("#o360-telemost-stage3-isolation-style")).toHaveLength(1);
  });

  it("fail-opens on unknown DOM", () => {
    document.body.innerHTML = `<div id="noise"><p>Loading portal</p></div>`;
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(api()?.state).toBe("UNKNOWN");
    expect(api()?.hiddenCount).toBe(0);
    expect(document.querySelector(".o360-telemost-hidden")).toBeNull();
    expect(api()?.events).toContain("fail-open unknown DOM");
  });

  it("does not hide dialogs", () => {
    document.body.innerHTML = `${prejoinHtml()}
      <div id="modal" role="dialog"><p>Тарифы для бизнеса</p><button>Закрыть</button></div>`;
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(document.getElementById("modal")?.className).not.toContain("o360-telemost-hidden");
  });

  it("does not hide video, audio, or canvas", () => {
    document.body.innerHTML = prejoinHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(document.getElementById("preview")?.className).not.toContain("o360-telemost-hidden");
    expect(document.getElementById("preview-audio")?.className).not.toContain("o360-telemost-hidden");
    expect(document.getElementById("preview-canvas")?.className).not.toContain("o360-telemost-hidden");
  });

  it("does not hide MEETING controls and hides only independent proven shell", () => {
    document.body.innerHTML = meetingHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(api()?.state).toBe("MEETING");
    expect(document.querySelector("#rail")?.className).toContain("o360-telemost-hidden");
    expect(document.querySelector("#tariff")?.className).toContain("o360-telemost-hidden");
    expect(document.querySelector("#footer")?.className).toContain("o360-telemost-hidden");
    for (const id of ["remote", "local", "mic", "camera", "participants", "chat", "reactions", "share", "settings", "leave", "stage"]) {
      expect(document.getElementById(id)?.className).not.toContain("o360-telemost-hidden");
    }
  });

  it("fail-opens when meeting chrome lives inside the global bar", () => {
    document.body.innerHTML = `
      <div id="rail" data-testid="orb-global-bar">
        <a>Почта</a>
        <video id="remote"></video>
        <button id="leave">Выйти из встречи</button>
      </div>`;
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(api()?.state).toBe("UNKNOWN");
    expect(api()?.hiddenCount).toBe(0);
    expect(document.querySelector("#rail")?.className).not.toContain("o360-telemost-hidden");
    expect(document.getElementById("remote")?.className).not.toContain("o360-telemost-hidden");
    expect(document.getElementById("leave")?.className).not.toContain("o360-telemost-hidden");
  });

  it("keeps hidden count stable under MutationObserver churn", async () => {
    document.body.innerHTML = prejoinHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    const before = api()?.hiddenCount;
    for (let index = 0; index < 20; index += 1) {
      const node = document.createElement("div");
      node.textContent = `churn-${index}`;
      document.body.append(node);
    }
    await Promise.resolve();
    expect(api()?.hiddenCount).toBe(before);
    expect(document.querySelector("#join")?.className).not.toContain("o360-telemost-hidden");
  });

  it("disconnects the observer after the idle window", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    document.body.innerHTML = prejoinHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(api()?.observerActive).toBe(true);
    vi.advanceTimersByTime(12000);
    expect(api()?.observerActive).toBe(false);
  });

  it("does not mutate document.title", () => {
    document.title = "Keep Telemost title";
    document.body.innerHTML = prejoinHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(document.title).toBe("Keep Telemost title");
    expect(document.title.startsWith("__O360_DOM_CAPTURE__")).toBe(false);
  });

  it("enters TRANSITION, unhides PREJOIN chrome, and stops hiding when JOIN is clicked", () => {
    document.body.innerHTML = prejoinHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(api()?.state).toBe("PREJOIN");
    expect(document.querySelector("#rail")?.className).toContain("o360-telemost-hidden");
    document.getElementById("join")?.click();
    expect(api()?.state).toBe("TRANSITION");
    expect(api()?.observerActive).toBe(false);
    expect(document.querySelector("#rail")?.className).not.toContain("o360-telemost-hidden");
    expect(document.querySelector("#tariff")?.className).not.toContain("o360-telemost-hidden");
    expect(document.querySelector("#footer")?.className).not.toContain("o360-telemost-hidden");
    expect(document.querySelector("#join")?.className).not.toContain("o360-telemost-hidden");
    expect(document.getElementById("prejoin")?.className).not.toContain("o360-telemost-hidden");
    expect(api()?.events).toContain("transition fail-open");
    const hidden = api()?.hiddenCount;
    document.getElementById("join")?.replaceChildren();
    document.body.append(document.createElement("div"));
    api()?.apply();
    expect(api()?.state).toBe("TRANSITION");
    expect(api()?.hiddenCount).toBe(hidden);
    expect(document.querySelector("#rail")?.className).not.toContain("o360-telemost-hidden");
  });

  it("applies MEETING shell hide once after TRANSITION when meeting chrome appears", () => {
    document.body.innerHTML = prejoinHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    document.getElementById("join")?.click();
    expect(api()?.state).toBe("TRANSITION");
    document.body.innerHTML = meetingHtml();
    mockPrejoinGeometry();
    api()?.apply();
    expect(api()?.state).toBe("MEETING");
    expect(document.querySelector("#rail")?.className).toContain("o360-telemost-hidden");
    expect(document.getElementById("leave")?.className).not.toContain("o360-telemost-hidden");
    expect(document.getElementById("chat")?.className).not.toContain("o360-telemost-hidden");
    expect(api()?.observerActive).toBe(false);
  });

  it("fail-opens ENDED without hiding official post-call UI", () => {
    document.body.innerHTML = `
      <div id="rail" data-testid="orb-global-bar"><a>Почта</a></div>
      <main id="ended"><p>Встреча завершена</p><button id="rejoin">Переподключиться</button></main>
      <footer id="footer">Поддержка Частые вопросы Скачать на MacOS Скачать на телефон</footer>`;
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(api()?.state).toBe("ENDED");
    expect(api()?.hiddenCount).toBe(0);
    expect(document.querySelector("#rail")?.className).not.toContain("o360-telemost-hidden");
    expect(document.getElementById("ended")?.className).not.toContain("o360-telemost-hidden");
    expect(document.getElementById("rejoin")?.className).not.toContain("o360-telemost-hidden");
  });

  it("does not hide a tariff ancestor that also contains the JOIN control", () => {
    document.body.innerHTML = `
      <div id="shell">
        <a id="tariff">Тарифы для бизнеса</a>
        <main id="prejoin"><button id="join">Подключиться</button></main>
      </div>`;
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(document.getElementById("shell")?.className).not.toContain("o360-telemost-hidden");
    expect(document.getElementById("join")?.className).not.toContain("o360-telemost-hidden");
  });

  it("does not treat CREATE home as PREJOIN", () => {
    setLocation("telemost.yandex.ru", "/");
    document.body.innerHTML = `
      <div id="rail" data-testid="orb-global-bar"><a>Почта</a></div>
      <button id="create">Создать видеовстречу</button>
      <footer id="footer">Поддержка Частые вопросы Скачать на MacOS Скачать на телефон</footer>`;
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(api()?.state).toBe("HOME");
    expect(api()?.hiddenCount).toBe(0);
    expect(document.querySelector("#rail")?.className).not.toContain("o360-telemost-hidden");
    expect(document.getElementById("create")?.className).not.toContain("o360-telemost-hidden");
  });

  it("is idempotent on repeated MEETING apply", () => {
    document.body.innerHTML = meetingHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    const first = api()?.hiddenCount;
    const className = document.querySelector("#rail")?.className;
    api()?.apply();
    api()?.apply();
    expect(api()?.hiddenCount).toBe(first);
    expect(document.querySelector("#rail")?.className).toBe(className);
    expect(document.querySelectorAll("#o360-telemost-stage3-isolation-style")).toHaveLength(1);
  });

  it("resets to dormant HOME after MEETING leave so Create stays usable", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    document.body.innerHTML = prejoinHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    document.getElementById("join")?.click();
    expect(api()?.state).toBe("TRANSITION");
    document.body.innerHTML = meetingHtml();
    mockPrejoinGeometry();
    api()?.apply();
    expect(api()?.state).toBe("MEETING");
    expect(api()?.leaveWatchActive).toBe(true);
    expect(api()?.observerActive).toBe(false);
    expect(api()?.transitionPollActive).toBe(false);
    expect(document.querySelector("#rail")?.className).toContain("o360-telemost-hidden");

    setLocation("telemost.yandex.ru", "/");
    document.body.innerHTML = homeHtml();
    mockPrejoinGeometry();
    vi.advanceTimersByTime(250);

    expect(api()?.state).toBe("HOME");
    expect(api()?.hiddenCount).toBe(0);
    expect(api()?.observerActive).toBe(false);
    expect(api()?.leaveWatchActive).toBe(false);
    expect(api()?.transitionPollActive).toBe(false);
    expect(document.querySelector(".o360-telemost-hidden")).toBeNull();
    expect(document.getElementById("create")?.className).not.toContain("o360-telemost-hidden");
    expect(document.getElementById("home")?.className).not.toContain("o360-telemost-hidden");
    expect(document.querySelector("#rail")?.className).not.toContain("o360-telemost-hidden");
    expect(document.getElementById("o360-telemost-stage3-isolation-style")?.textContent).toBe(
      ".o360-telemost-hidden{display:none!important}",
    );
  });

  it("treats SPA HOME with Create CTA as HOME even while path stays /j/", () => {
    document.body.innerHTML = meetingHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(api()?.state).toBe("MEETING");
    document.body.innerHTML = `
      ${homeHtml()}
      <video id="stale-remote"></video>
      <button id="stale-chat">Чат</button>`;
    mockPrejoinGeometry();
    api()?.apply();
    expect(api()?.state).toBe("HOME");
    expect(api()?.hiddenCount).toBe(0);
    expect(api()?.observerActive).toBe(false);
    expect(api()?.leaveWatchActive).toBe(false);
    expect(document.getElementById("create")?.className).not.toContain("o360-telemost-hidden");
    expect(document.querySelector(".o360-telemost-hidden")).toBeNull();
  });

  it("reapplies PREJOIN isolation after HOME from a prior meeting", () => {
    document.body.innerHTML = meetingHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    setLocation("telemost.yandex.ru", "/");
    document.body.innerHTML = homeHtml();
    mockPrejoinGeometry();
    api()?.apply();
    expect(api()?.state).toBe("HOME");
    expect(api()?.hiddenCount).toBe(0);

    setLocation("telemost.yandex.ru", "/j/999");
    document.body.innerHTML = prejoinHtml();
    mockPrejoinGeometry();
    api()?.apply();
    expect(api()?.state).toBe("PREJOIN");
    expect(document.querySelector("#rail")?.className).toContain("o360-telemost-hidden");
    expect(document.querySelector("#tariff")?.className).toContain("o360-telemost-hidden");
    expect(document.querySelector("#footer")?.className).toContain("o360-telemost-hidden");
    expect(document.getElementById("join")?.className).not.toContain("o360-telemost-hidden");
    expect(api()?.observerActive).toBe(true);
  });

  it("reapplies PREJOIN isolation when MEETING navigates to another /j/", () => {
    document.body.innerHTML = meetingHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(api()?.state).toBe("MEETING");
    setLocation("telemost.yandex.ru", "/j/456");
    document.body.innerHTML = prejoinHtml();
    mockPrejoinGeometry();
    api()?.apply();
    expect(api()?.state).toBe("PREJOIN");
    expect(document.querySelector("#rail")?.className).toContain("o360-telemost-hidden");
    expect(document.getElementById("join")?.className).not.toContain("o360-telemost-hidden");
    expect(api()?.leaveWatchActive).toBe(false);
  });

  it("reconciles MEETING leave on popstate without touching JOIN skip", () => {
    document.body.innerHTML = meetingHtml();
    mockPrejoinGeometry();
    eval(SCRIPT);
    expect(api()?.state).toBe("MEETING");
    setLocation("telemost.yandex.ru", "/");
    document.body.innerHTML = homeHtml();
    mockPrejoinGeometry();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(api()?.state).toBe("HOME");
    expect(api()?.hiddenCount).toBe(0);
    expect(document.getElementById("create")?.className).not.toContain("o360-telemost-hidden");
  });
});
