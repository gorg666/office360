// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCRIPT = readFileSync(resolve(process.cwd(), "src-tauri/src/telemost_leave_to_idle.js"), "utf8");

type LeaveApi = { armed: boolean; emitted: boolean; sawLeave: boolean; sawRating: boolean; stop: () => void };

function api(): LeaveApi | undefined {
  return (window as Window & { __o360TelemostLeaveToIdle?: LeaveApi }).__o360TelemostLeaveToIdle;
}

function setLocation(pathname: string): void {
  vi.stubGlobal("location", {
    hostname: "telemost.yandex.ru",
    pathname,
    href: `https://telemost.yandex.ru${pathname}`,
    protocol: "https:",
    host: "telemost.yandex.ru",
  });
}

beforeEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  delete (window as Window & { __o360TelemostLeaveToIdle?: unknown }).__o360TelemostLeaveToIdle;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, "innerText", { configurable: true, get() { return this.textContent ?? ""; } });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 10, top: 10, width: 220, height: 40, right: 230, bottom: 50, x: 10, y: 10, toJSON: () => ({}),
  } as DOMRect);
  setLocation("/j/123");
  document.title = "Встреча";
});

afterEach(() => {
  api()?.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("leave returns Office360 idle", () => {
  it("does not emit on initial HOME create chrome", () => {
    setLocation("/");
    document.body.innerHTML = `<button>Создать видеовстречу</button><button>Подключиться</button>`;
    eval(SCRIPT);
    vi.advanceTimersByTime(1000);
    expect(api()?.armed).toBe(false);
    expect(api()?.emitted).toBe(false);
    expect(document.title).toBe("Встреча");
  });

  it("does not arm on HOME even if a promo video is present", () => {
    setLocation("/");
    document.body.innerHTML = `<video></video><button>Создать видеовстречу</button>`;
    eval(SCRIPT);
    vi.advanceTimersByTime(1000);
    expect(api()?.armed).toBe(false);
    expect(api()?.emitted).toBe(false);
  });

  it("arms on the official Выйти из встречи leave control", () => {
    document.body.innerHTML = `<button>Выйти из встречи</button>`;
    eval(SCRIPT);
    vi.advanceTimersByTime(300);
    expect(api()?.sawLeave).toBe(true);
    expect(api()?.emitted).toBe(false);
  });

  it("does not emit while the official rating modal is open after Leave", () => {
    document.body.innerHTML = `<button>Покинуть</button><video></video>`;
    eval(SCRIPT);
    vi.advanceTimersByTime(300);
    expect(api()?.armed).toBe(true);
    document.body.innerHTML = `<div role="dialog" aria-modal="true"><h2>Оцените качество связи</h2><button>Отправить</button></div>`;
    vi.advanceTimersByTime(300);
    expect(api()?.sawRating).toBe(true);
    expect(api()?.emitted).toBe(false);
    expect(document.title).toBe("Встреча");
  });

  it("emits once after the rating modal is dismissed and HOME is present", () => {
    document.body.innerHTML = `<button>Покинуть</button>`;
    eval(SCRIPT);
    vi.advanceTimersByTime(300);
    document.body.innerHTML = `<div role="dialog" aria-modal="true"><p>Оцените качество связи</p><button aria-label="Закрыть">X</button></div>`;
    vi.advanceTimersByTime(300);
    expect(api()?.emitted).toBe(false);
    document.body.innerHTML = `<button>Создать видеовстречу</button><button>Подключиться</button>`;
    vi.advanceTimersByTime(300);
    expect(api()?.emitted).toBe(true);
    expect(document.title).toBe("__O360_TELEMOST_LEFT__");
    document.body.append(document.createElement("span"));
    vi.advanceTimersByTime(500);
    expect(document.title).toBe("__O360_TELEMOST_LEFT__");
  });

  it("emits after Leave when HOME appears without a rating modal, even with Подключиться", () => {
    document.body.innerHTML = `<button>Покинуть встречу</button>`;
    eval(SCRIPT);
    vi.advanceTimersByTime(300);
    document.body.innerHTML = `<button>Создать видеовстречу</button><button>Подключиться</button>`;
    vi.advanceTimersByTime(400);
    expect(api()?.emitted).toBe(false);
    vi.advanceTimersByTime(1800);
    expect(api()?.emitted).toBe(true);
  });

  it("does not treat an unrelated dialog as the rating modal", () => {
    document.body.innerHTML = `<button>Покинуть</button>`;
    eval(SCRIPT);
    vi.advanceTimersByTime(300);
    document.body.innerHTML = `<div role="dialog"><h2>Настройки</h2></div><button>Создать видеовстречу</button>`;
    vi.advanceTimersByTime(400);
    expect(api()?.sawRating).toBe(false);
    expect(api()?.emitted).toBe(false);
    vi.advanceTimersByTime(1800);
    expect(api()?.emitted).toBe(true);
  });

  it("does not emit on PREJOIN /j/ with promo video before Leave", () => {
    document.body.innerHTML = `<video></video><button>Присоединиться</button>`;
    eval(SCRIPT);
    vi.advanceTimersByTime(1200);
    expect(api()?.armed).toBe(true);
    expect(api()?.sawLeave).toBe(false);
    expect(api()?.emitted).toBe(false);
    expect(document.title).toBe("Встреча");
  });

  it("does not emit on PREJOIN /j/ video if join chrome is delayed", () => {
    document.body.innerHTML = `<video></video>`;
    eval(SCRIPT);
    vi.advanceTimersByTime(1200);
    expect(api()?.armed).toBe(true);
    expect(api()?.emitted).toBe(false);
    document.body.innerHTML = `<video></video><button>Присоединиться</button>`;
    vi.advanceTimersByTime(800);
    expect(api()?.emitted).toBe(false);
  });

  it("emits even if Telemost SPA keeps the /j/ path after leave", () => {
    document.body.innerHTML = `<button>Покинуть встречу</button>`;
    eval(SCRIPT);
    vi.advanceTimersByTime(300);
    expect(api()?.armed).toBe(true);
    document.body.innerHTML = `<button>Создать видеовстречу</button>`;
    vi.advanceTimersByTime(400);
    expect(api()?.emitted).toBe(false);
    vi.advanceTimersByTime(1800);
    expect(api()?.emitted).toBe(true);
  });
});
