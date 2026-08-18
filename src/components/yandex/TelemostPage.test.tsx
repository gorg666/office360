import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopPlatform } from "@/utils/desktopPlatform";
import { invalidateVerifiedBrowserAuth, AUTH_CHECK_WATCHDOG_MS } from "@/services/telemost/directJoinAuth";

const mocks = vi.hoisted(() => ({
  platform: "macos" as DesktopPlatform,
  openUrl: vi.fn(),
  cefInitialize: vi.fn(),
  cefCreate: vi.fn(),
  cefNavigate: vi.fn(),
  cefSetBounds: vi.fn(),
  cefSetVisible: vi.fn(),
  cefCloseBrowser: vi.fn(),
  cefHasYandexSession: vi.fn(),
  cefResetAccountProfile: vi.fn(),
  cefProbeSession: vi.fn(),
  createConference: vi.fn(),
  deleteConference: vi.fn(),
  getCalendarEvents: vi.fn(),
  invoke: vi.fn(),
  listeners: {} as Record<string, (event: { payload: string }) => void>,
  navigateToLabel: vi.fn(),
  hasGrantScopes: vi.fn(),
  authorizeGrant: vi.fn(),
  createMeetingWeb: vi.fn(),
}));

vi.mock("@/utils/desktopPlatform", () => ({
  getDesktopPlatform: vi.fn(async () => mocks.platform),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (event: string, handler: (event: { payload: string }) => void) => { mocks.listeners[event] = handler; return () => { delete mocks.listeners[event]; }; }) }));
vi.mock("@/services/cef", () => ({
  cefInitialize: mocks.cefInitialize,
  cefCreate: mocks.cefCreate,
  cefNavigate: mocks.cefNavigate,
  cefPermissionResponse: vi.fn(),
  cefSetBounds: mocks.cefSetBounds,
  cefSetVisible: mocks.cefSetVisible,
  cefCloseBrowser: mocks.cefCloseBrowser,
  cefHasYandexSession: mocks.cefHasYandexSession,
  cefResetAccountProfile: mocks.cefResetAccountProfile,
  cefProbeSession: mocks.cefProbeSession,
}));
vi.mock("@/stores/accountStore", () => ({
  useAccountStore: (selector: (state: unknown) => unknown) => selector({
    activeAccountId: "account-1",
    accounts: [{ id: "account-1", email: "person@example.test" }],
  }),
}));
vi.mock("@/services/db/accounts", () => ({
  getAccount: vi.fn(async () => ({ oauth_provider: "yandex", auth_method: "oauth2" })),
}));
vi.mock("@/services/db/calendarEvents", () => ({
  getCalendarEventsInRange: mocks.getCalendarEvents,
}));
vi.mock("@/services/yandex360/telemost", () => ({
  createTelemostConference: mocks.createConference,
  deleteTelemostConference: mocks.deleteConference,
  getTelemostConference: vi.fn(),
  updateTelemostConference: vi.fn(),
  TelemostApiError: class TelemostApiError extends Error { constructor(public code: string, message: string) { super(message); } },
}));
vi.mock("@/services/oauth/yandexUnifiedAuth", () => ({
  authorizeYandexGrant: mocks.authorizeGrant,
  hasYandexGrantScopes: mocks.hasGrantScopes,
  TELEMOST_REQUIRED_SCOPES: ["create", "read", "update"],
}));
vi.mock("@/services/telemost/meetingActions", () => ({ createTelemostMeetingWeb: mocks.createMeetingWeb }));
vi.mock("@/router/navigate", () => ({ navigateToLabel: mocks.navigateToLabel }));
vi.mock("@/utils/openComposeWindow", () => ({ openNewCompose: vi.fn() }));
vi.mock("./ServicePageShell", () => ({
  ServicePageShell: ({ title, description, actions, children }: { title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }) => <main><h1>{title}</h1><p>{description}</p>{actions}{children}</main>,
}));

import { TelemostPage } from "./TelemostPage";

vi.stubGlobal("ResizeObserver", class {
  observe(): void {}
  disconnect(): void {}
});

const RECENT_URL = "https://telemost.yandex.ru/j/123456789";
const SURFACE_BOUNDS = { x: 100, y: 120, width: 800, height: 600 };

async function renderReady(): Promise<void> {
  render(<TelemostPage />);
  await screen.findByText("Создайте новую встречу или подключитесь по ссылке.");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform = "macos";
  mocks.openUrl.mockResolvedValue(undefined);
  mocks.cefInitialize.mockResolvedValue(undefined);
  mocks.cefCreate.mockResolvedValue(undefined);
  mocks.cefNavigate.mockResolvedValue(undefined);
  mocks.cefSetBounds.mockResolvedValue(undefined);
  mocks.cefSetVisible.mockResolvedValue(undefined);
  mocks.cefCloseBrowser.mockResolvedValue(undefined);
  mocks.cefHasYandexSession.mockResolvedValue(false);
  mocks.cefResetAccountProfile.mockResolvedValue(undefined);
  mocks.cefProbeSession.mockResolvedValue(undefined);
  mocks.getCalendarEvents.mockResolvedValue([]);
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.hasGrantScopes.mockResolvedValue(true);
  mocks.authorizeGrant.mockResolvedValue(undefined);
  mocks.createMeetingWeb.mockResolvedValue("wkwebview");
  mocks.deleteConference.mockResolvedValue(undefined);
  mocks.listeners = {};
  localStorage.clear();
  sessionStorage.clear();
  invalidateVerifiedBrowserAuth();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: SURFACE_BOUNDS.x,
    y: SURFACE_BOUNDS.y,
    width: SURFACE_BOUNDS.width,
    height: SURFACE_BOUNDS.height,
    top: SURFACE_BOUNDS.y,
    left: SURFACE_BOUNDS.x,
    bottom: SURFACE_BOUNDS.y + SURFACE_BOUNDS.height,
    right: SURFACE_BOUNDS.x + SURFACE_BOUNDS.width,
    toJSON: () => ({}),
  } as DOMRect);
});

describe("Telemost native macOS shell", () => {
  it("does not initialize CEF or show a generic Yandex web home", async () => {
    await renderReady();

    expect(mocks.cefInitialize).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.anything());
    expect(screen.queryByLabelText("Поверхность встречи Телемоста")).not.toBeInTheDocument();
    expect(document.body.textContent).toContain("Создайте новую встречу или подключитесь по ссылке.");
    expect(document.body.textContent).not.toContain("Тарифы для бизнеса");
    expect(document.body.textContent).not.toContain("Телемост откроется в браузере");
    expect(document.body.textContent).not.toContain("Windows x64");
  });

  it("mounts a child WKWebView in the right pane with container bounds", async () => {
    await renderReady();

    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: RECENT_URL, accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    expect(screen.getByText("Встречи")).toBeInTheDocument();
    expect(screen.getByLabelText("Поверхность встречи Телемоста")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Закрыть встречу/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Скопировать ссылку/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Открыть в браузере$/ })).not.toBeInTheDocument();
    expect(mocks.cefCreate).not.toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("keeps the join URL field and connect button wrapping so the action cannot clip", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    const row = screen.getByTestId("telemost-join-row");
    expect(row.className).toMatch(/flex-wrap/);
    const connectButton = screen.getByRole("dialog", { name: "Подключиться к встрече" }).querySelector("button.btn-primary");
    expect(connectButton).toHaveClass("shrink-0");
    expect(screen.getByRole("button", { name: "Отмена" })).toHaveClass("shrink-0");
    expect(screen.getByLabelText("Ссылка на встречу")).toHaveClass("min-w-0");
    expect(connectButton).toHaveTextContent("Подключиться");
  });

  it("opens a recent meeting URL in the right-pane WKWebView surface", async () => {
    localStorage.setItem("office360_telemost_visited:account-1", JSON.stringify([{
      id: "123456789",
      title: "Недавняя встреча",
      joinUrl: RECENT_URL,
      source: "visited",
    }]));
    await renderReady();
    const recentMeeting = await screen.findByRole("button", { name: /Недавняя встреча/ });

    fireEvent.click(recentMeeting);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: RECENT_URL, accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    expect(screen.getByText("Встречи")).toBeInTheDocument();
    expect(screen.getByLabelText("Поверхность встречи Телемоста")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Закрыть встречу/ })).not.toBeInTheDocument();
    expect(mocks.cefCreate).not.toHaveBeenCalled();
  });

  it("opens an existing calendar meeting URL in the right-pane WKWebView surface", async () => {
    mocks.getCalendarEvents.mockResolvedValueOnce([{
      id: "calendar-event-1",
      summary: "Встреча из календаря",
      description: `Ссылка: ${RECENT_URL}`,
      location: null,
      html_link: null,
      ical_data: null,
      start_time: 1_786_509_600,
      end_time: 1_786_513_200,
      organizer_email: null,
      attendees_json: null,
    }]);
    await renderReady();
    const calendarMeeting = await screen.findByRole("button", { name: /Встреча из календаря/ });

    fireEvent.click(calendarMeeting);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: RECENT_URL, accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    expect(screen.getByText("Встречи")).toBeInTheDocument();
    expect(mocks.cefCreate).not.toHaveBeenCalled();
  });

  it("opens a calendar Telemost deep-link through WKWebView without CEF", async () => {
    sessionStorage.setItem("office360_telemost_open_event_id", "calendar-event-1");
    mocks.getCalendarEvents.mockResolvedValueOnce([{
      id: "calendar-event-1",
      summary: "Встреча из календаря",
      description: `Ссылка: ${RECENT_URL}`,
      location: null,
      html_link: null,
      ical_data: null,
      start_time: 1_786_509_600,
      end_time: 1_786_513_200,
      organizer_email: null,
      attendees_json: null,
    }]);
    await renderReady();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: RECENT_URL, accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    expect(mocks.cefCreate).not.toHaveBeenCalled();
    expect(mocks.cefNavigate).not.toHaveBeenCalled();
  });

  it("deduplicates calendar and recent entries for the same Telemost meeting", async () => {
    localStorage.setItem("office360_telemost_visited:account-1", JSON.stringify([{
      id: "123456789",
      title: "Недавний дубль",
      joinUrl: "https://telemost.360.yandex.ru/j/123456789",
      source: "visited",
    }]));
    mocks.getCalendarEvents.mockResolvedValueOnce([{
      id: "calendar-event-1",
      summary: "Одна встреча",
      description: `Ссылка: ${RECENT_URL}`,
      location: null,
      html_link: null,
      ical_data: null,
      start_time: 1_786_509_600,
      end_time: 1_786_513_200,
      organizer_email: null,
      attendees_json: null,
    }]);

    await renderReady();

    expect(await screen.findByRole("button", { name: /Одна встреча/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Недавний дубль/ })).not.toBeInTheDocument();
  });

  it("opens a meeting without a custom right-pane action toolbar", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", expect.anything()));

    expect(screen.getByLabelText("Поверхность встречи Телемоста")).toBeInTheDocument();
    expect(screen.getByText("Встречи")).toBeInTheDocument();
    expect(screen.queryByText("Создайте новую встречу или подключитесь по ссылке.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Закрыть" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Скопировать ссылку/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Открыть в браузере$/ })).not.toBeInTheDocument();
  });

  it("shows retry and explicit browser fallback only when child WKWebView creation fails", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "open_telemost_macos_embedded") throw new Error("WKWebView unavailable");
    });
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);

    expect(await screen.findByText(/WKWebView POC:.*WKWebView unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Открыть в браузере" })).toBeInTheDocument();
    expect(mocks.openUrl).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_spike", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "Открыть в браузере" }));
    await waitFor(() => expect(mocks.openUrl).toHaveBeenCalledWith(RECENT_URL));
  });

  it("preserves a localized browser fallback when WKWebView and opener both fail", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "open_telemost_macos_embedded") throw new Error("WKWebView unavailable");
    });
    mocks.openUrl.mockRejectedValueOnce(new Error("opener unavailable"));
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);

    expect(await screen.findByText(/WKWebView POC:.*WKWebView unavailable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Открыть в браузере" }));
    expect(await screen.findByText("Не удалось открыть Телемост в браузере.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("opener unavailable");
  });

  it("traps a generic Yandex redirect and offers retry plus browser fallback", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);
    await waitFor(() => expect(mocks.listeners["telemost-macos-routing-error"]).toBeDefined());

    act(() => mocks.listeners["telemost-macos-routing-error"]({ payload: "https://telemost.yandex.ru/" }));

    expect((await screen.findAllByText("Не удалось открыть видеовстречу внутри приложения.")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Открыть в браузере" })).toBeInTheDocument();
    expect(screen.getByText("Встречи")).toBeInTheDocument();
  });

  it("opens a real meeting URL through the right-pane child WKWebView", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: RECENT_URL, accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    expect(screen.getByText("Встречи")).toBeInTheDocument();
    expect(screen.getByLabelText("Поверхность встречи Телемоста")).toBeInTheDocument();
    expect(mocks.cefCreate).not.toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("does not reset an open meeting when the child webview reports a programmatic detach", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", expect.anything()));

    act(() => {
      mocks.listeners["telemost-macos-embedded-closed"]?.({ payload: "" });
    });

    expect(screen.getByLabelText("Поверхность встречи Телемоста")).toBeInTheDocument();
    expect(screen.queryByText("Создайте новую встречу или подключитесь по ссылке.")).not.toBeInTheDocument();
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("destroys the child WKWebView before switching Telemost account", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", expect.anything()));
    fireEvent.click(screen.getByRole("button", { name: "Сменить аккаунт Телемоста" }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("reset_telemost_macos_profile", { accountKey: "account-1" }));
    expect(mocks.invoke).toHaveBeenCalledWith("close_telemost_macos_embedded");
    expect(mocks.cefResetAccountProfile).not.toHaveBeenCalled();
    expect(mocks.cefCreate).not.toHaveBeenCalled();
    expect(mocks.cefNavigate).not.toHaveBeenCalled();
    expect(await screen.findByText("Создайте новую встречу или подключитесь по ссылке.")).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.objectContaining({
      url: "https://telemost.yandex.ru/?browser-auto-create=1",
    }));
  });

  it("fails closed when visual PREJOIN never becomes ready", async () => {
    mocks.createConference.mockResolvedValue({
      id: "1327816640", title: null, joinUrl: "https://telemost.360.yandex.ru/j/1327816640", organizer: null,
      createdAt: null, scheduledAt: null, status: null, liveStreamWatchUrl: null,
    });
    vi.spyOn(window, "prompt").mockReturnValue("");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.listeners["telemost-macos-auth-authenticated"]).toBeDefined());
    act(() => mocks.listeners["telemost-macos-auth-authenticated"]({
      payload: "auth=AUTHENTICATED;uid=42;login=person@example.test;surface=check",
    }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: "https://telemost.360.yandex.ru/j/1327816640", accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    await waitFor(() => expect(mocks.listeners["telemost-macos-prejoin-timeout"]).toBeDefined());
    act(() => mocks.listeners["telemost-macos-prejoin-timeout"]({ payload: "PREJOIN" }));
    await waitFor(() => expect(screen.getByText("Не удалось открыть экран подключения. Повторите.")).toBeInTheDocument());
    expect(screen.queryByLabelText("Поверхность встречи Телемоста")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("office360_telemost_pending_join:account-1")).toContain("1327816640");
    mocks.invoke.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: "https://telemost.360.yandex.ru/j/1327816640", accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.objectContaining({
      url: "https://telemost.360.yandex.ru/?office360-auth-check=1",
    }));
    expect(mocks.createConference).toHaveBeenCalledTimes(1);
  });

  it("keeps API CREATE but checks WK Passport before opening /j/", async () => {
    mocks.createConference.mockResolvedValue({
      id: "new-1", title: null, joinUrl: "https://telemost.360.yandex.ru/j/7110455263", organizer: null,
      createdAt: null, scheduledAt: null, status: null, liveStreamWatchUrl: null,
    });
    vi.spyOn(window, "prompt").mockReturnValue("");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: "https://telemost.360.yandex.ru/?office360-auth-check=1", accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    expect(screen.getByLabelText("Подготавливаем встречу")).toBeInTheDocument();
    expect(sessionStorage.getItem("office360_telemost_pending_join:account-1")).toContain("7110455263");
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.objectContaining({
      url: "https://telemost.360.yandex.ru/j/7110455263",
    }));
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.objectContaining({
      url: "https://telemost.yandex.ru/?browser-auto-create=1",
    }));
    act(() => mocks.listeners["telemost-macos-auth-authenticated"]({
      payload: "auth=AUTHENTICATED;uid=42;login=person@example.test;surface=check",
    }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: "https://telemost.360.yandex.ru/j/7110455263", accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    expect(sessionStorage.getItem("office360_telemost_pending_join:account-1")).toContain("7110455263");
    await waitFor(() => expect(mocks.listeners["telemost-macos-prejoin-ready"]).toBeDefined());
    act(() => mocks.listeners["telemost-macos-prejoin-ready"]({ payload: "PREJOIN" }));
    await waitFor(() => expect(sessionStorage.getItem("office360_telemost_pending_join:account-1")).toBeNull());
    expect(screen.getByLabelText("Поверхность встречи Телемоста")).toBeInTheDocument();
    expect(mocks.cefCreate).not.toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("skips HOME auth-check on a second create for the same verified account", async () => {
    mocks.createConference
      .mockResolvedValueOnce({
        id: "111", title: null, joinUrl: "https://telemost.360.yandex.ru/j/111", organizer: null,
        createdAt: null, scheduledAt: null, status: null, liveStreamWatchUrl: null,
      })
      .mockResolvedValueOnce({
        id: "222", title: null, joinUrl: "https://telemost.360.yandex.ru/j/222", organizer: null,
        createdAt: null, scheduledAt: null, status: null, liveStreamWatchUrl: null,
      });
    vi.spyOn(window, "prompt").mockReturnValue("");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: "https://telemost.360.yandex.ru/?office360-auth-check=1", accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    act(() => mocks.listeners["telemost-macos-auth-authenticated"]({
      payload: "auth=AUTHENTICATED;uid=42;login=person@example.test;surface=check",
    }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: "https://telemost.360.yandex.ru/j/111", accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    act(() => mocks.listeners["telemost-macos-prejoin-ready"]({ payload: "PREJOIN" }));
    await waitFor(() => expect(sessionStorage.getItem("office360_telemost_pending_join:account-1")).toBeNull());
    mocks.invoke.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: "https://telemost.360.yandex.ru/j/222", accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.objectContaining({
      url: "https://telemost.360.yandex.ru/?office360-auth-check=1",
    }));
    expect(mocks.createConference).toHaveBeenCalledTimes(2);
  });

  it("does not open WEB CREATE HOME after API CREATE owns the join surface", async () => {
    const joinUrl = "https://telemost.360.yandex.ru/j/3320691266";
    mocks.createConference.mockResolvedValue({
      id: "3320691266", title: null, joinUrl, organizer: null,
      createdAt: null, scheduledAt: null, status: null, liveStreamWatchUrl: null,
    });
    vi.spyOn(window, "prompt").mockReturnValue("");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: "https://telemost.360.yandex.ru/?office360-auth-check=1", accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    expect(mocks.createConference).toHaveBeenCalledTimes(1);
    const payload = { payload: "auth=AUTHENTICATED;uid=1130000072185511;login=person@example.test;surface=check" };
    act(() => mocks.listeners["telemost-macos-auth-authenticated"](payload));
    act(() => mocks.listeners["telemost-macos-auth-authenticated"](payload));
    act(() => mocks.listeners["telemost-macos-auth-required"]({ payload: "auth=TIMEOUT;surface=create" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: joinUrl, accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    expect(mocks.invoke.mock.calls.filter((call) =>
      call[0] === "open_telemost_macos_embedded"
      && (call[1] as { url?: string } | undefined)?.url === joinUrl
    )).toHaveLength(1);
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.objectContaining({
      url: "https://telemost.yandex.ru/?browser-auto-create=1",
    }));
    expect(mocks.invoke.mock.calls.filter((call) =>
      call[0] === "open_telemost_macos_embedded"
    ).every((call) => (call[1] as { accountKey?: string } | undefined)?.accountKey === "account-1")).toBe(true);
    expect(mocks.createMeetingWeb).not.toHaveBeenCalled();
    act(() => mocks.listeners["telemost-macos-prejoin-ready"]({ payload: "PREJOIN" }));
    await waitFor(() => expect(sessionStorage.getItem("office360_telemost_pending_join:account-1")).toBeNull());
  });

  it("does not call startWebCreate when API_AVAILABLE", async () => {
    localStorage.setItem("office360_telemost_capability:account-1", "API_AVAILABLE");
    mocks.createConference.mockResolvedValue({
      id: "new-1", title: null, joinUrl: "https://telemost.360.yandex.ru/j/7110455263", organizer: null,
      createdAt: null, scheduledAt: null, status: null, liveStreamWatchUrl: null,
    });
    vi.spyOn(window, "prompt").mockReturnValue("");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.createConference).toHaveBeenCalled());
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.objectContaining({
      url: "https://telemost.yandex.ru/?browser-auto-create=1",
    }));
    expect(mocks.createMeetingWeb).not.toHaveBeenCalled();
  });

  it("opens the pending /j/ once when AUTHENTICATED is delivered twice", async () => {
    mocks.createConference.mockResolvedValue({
      id: "new-1", title: null, joinUrl: "https://telemost.360.yandex.ru/j/7110455263", organizer: null,
      createdAt: null, scheduledAt: null, status: null, liveStreamWatchUrl: null,
    });
    vi.spyOn(window, "prompt").mockReturnValue("");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.listeners["telemost-macos-auth-authenticated"]).toBeDefined());
    const payload = { payload: "auth=AUTHENTICATED;uid=42;login=person@example.test;surface=check" };
    act(() => mocks.listeners["telemost-macos-auth-authenticated"](payload));
    act(() => mocks.listeners["telemost-macos-auth-authenticated"](payload));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: "https://telemost.360.yandex.ru/j/7110455263", accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    expect(mocks.invoke.mock.calls.filter((call) =>
      call[0] === "open_telemost_macos_embedded"
      && (call[1] as { url?: string } | undefined)?.url === "https://telemost.360.yandex.ru/j/7110455263"
    )).toHaveLength(1);
    act(() => mocks.listeners["telemost-macos-prejoin-ready"]({ payload: "PREJOIN" }));
    await waitFor(() => expect(sessionStorage.getItem("office360_telemost_pending_join:account-1")).toBeNull());
    expect(screen.getByLabelText("Поверхность встречи Телемоста")).toBeInTheDocument();
  });

  it("cancels the auth-check watchdog after AUTHENTICATED", async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalClearTimeout = window.clearTimeout.bind(window);
    let watchdogHandle: number | null = null;
    let watchdogFn: (() => void) | null = null;
    const setTimeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation(((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === AUTH_CHECK_WATCHDOG_MS && typeof handler === "function") {
        watchdogFn = handler as () => void;
        watchdogHandle = 4242;
        return 4242 as unknown as ReturnType<typeof setTimeout>;
      }
      return originalSetTimeout(handler, delay, ...args);
    }) as typeof setTimeout);
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout").mockImplementation((id?: ReturnType<typeof setTimeout>) => {
      if (id === 4242) {
        watchdogFn = null;
        watchdogHandle = null;
        return;
      }
      originalClearTimeout(id as number);
    });
    mocks.createConference.mockResolvedValue({
      id: "new-1", title: null, joinUrl: "https://telemost.360.yandex.ru/j/7110455263", organizer: null,
      createdAt: null, scheduledAt: null, status: null, liveStreamWatchUrl: null,
    });
    vi.spyOn(window, "prompt").mockReturnValue("");
    try {
      await renderReady();
      fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
      await waitFor(() => expect(watchdogHandle).toBe(4242));
      act(() => mocks.listeners["telemost-macos-auth-authenticated"]({
        payload: "auth=AUTHENTICATED;uid=42;login=person@example.test;surface=check",
      }));
      expect(clearTimeoutSpy).toHaveBeenCalledWith(4242);
      expect(watchdogFn).toBeNull();
      expect(watchdogHandle).toBeNull();
      await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
        url: "https://telemost.360.yandex.ru/j/7110455263", accountKey: "account-1", bounds: SURFACE_BOUNDS,
      }));
      expect(screen.queryByText("Для входа во встречу через ваш Яндекс ID требуется авторизация.")).not.toBeInTheDocument();
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });

  it("bootstraps Passport and keeps pending /j/ when auth-check is anonymous", async () => {
    mocks.createConference.mockResolvedValue({
      id: "new-1", title: null, joinUrl: RECENT_URL, organizer: null,
      createdAt: null, scheduledAt: null, status: null, liveStreamWatchUrl: null,
    });
    vi.spyOn(window, "prompt").mockReturnValue("");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.listeners["telemost-macos-auth-required"]).toBeDefined());
    act(() => mocks.listeners["telemost-macos-auth-required"]({ payload: "auth=REQUIRED;surface=check" }));
    act(() => mocks.listeners["telemost-macos-auth-required"]({ payload: "auth=REQUIRED;surface=check" }));
    expect(screen.getByText("Откройте окно Яндекс ID. Гостевая встреча не открывается.")).toBeInTheDocument();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_oauth_login_window", expect.objectContaining({
      purpose: "passport-bootstrap",
      accountKey: "account-1",
    })));
    expect(mocks.invoke.mock.calls.filter((call) => call[0] === "open_oauth_login_window")).toHaveLength(1);
    expect(mocks.createConference).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("office360_telemost_pending_join:account-1")).toContain("/j/123456789");
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.objectContaining({
      url: RECENT_URL,
    }));
    act(() => mocks.listeners["yandex-passport-bootstrap-complete"]({ payload: "" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: "https://telemost.yandex.ru/?office360-auth-check=1", accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.objectContaining({
      url: "https://telemost.yandex.ru/?browser-auto-create=1",
    }));
    expect(sessionStorage.getItem("office360_telemost_pending_join:account-1")).toContain(RECENT_URL);
  });

  it("opens the pending /j/ after bootstrap recheck authenticates", async () => {
    mocks.createConference.mockResolvedValue({
      id: "new-1", title: null, joinUrl: RECENT_URL, organizer: null,
      createdAt: null, scheduledAt: null, status: null, liveStreamWatchUrl: null,
    });
    vi.spyOn(window, "prompt").mockReturnValue("");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.listeners["telemost-macos-auth-required"]).toBeDefined());
    act(() => mocks.listeners["telemost-macos-auth-required"]({ payload: "auth=REQUIRED;surface=check" }));
    act(() => mocks.listeners["yandex-passport-bootstrap-complete"]({ payload: "" }));
    act(() => mocks.listeners["telemost-macos-auth-authenticated"]({
      payload: "auth=AUTHENTICATED;uid=42;login=person@example.test;surface=check",
    }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: RECENT_URL, accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    act(() => mocks.listeners["telemost-macos-prejoin-ready"]({ payload: "PREJOIN" }));
    expect(sessionStorage.getItem("office360_telemost_pending_join:account-1")).toBeNull();
    expect(mocks.createConference).toHaveBeenCalledTimes(1);
  });

  it("fails closed if bootstrap recheck is still REQUIRED", async () => {
    mocks.createConference.mockResolvedValue({
      id: "new-1", title: null, joinUrl: RECENT_URL, organizer: null,
      createdAt: null, scheduledAt: null, status: null, liveStreamWatchUrl: null,
    });
    vi.spyOn(window, "prompt").mockReturnValue("");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.listeners["telemost-macos-auth-required"]).toBeDefined());
    act(() => mocks.listeners["telemost-macos-auth-required"]({ payload: "auth=REQUIRED;surface=check" }));
    act(() => mocks.listeners["yandex-passport-bootstrap-complete"]({ payload: "" }));
    act(() => mocks.listeners["telemost-macos-auth-required"]({ payload: "auth=REQUIRED;surface=check" }));
    expect(screen.getByText("Для входа во встречу через ваш Яндекс ID требуется авторизация.")).toBeInTheDocument();
    expect(await screen.findByText("Создайте новую встречу или подключитесь по ссылке.")).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.objectContaining({
      url: RECENT_URL,
    }));
    expect(sessionStorage.getItem("office360_telemost_pending_join:account-1")).toBeNull();
  });

  it("fails closed on Passport cancel and does not open guest /j/", async () => {
    mocks.createConference.mockResolvedValue({
      id: "new-1", title: null, joinUrl: RECENT_URL, organizer: null,
      createdAt: null, scheduledAt: null, status: null, liveStreamWatchUrl: null,
    });
    vi.spyOn(window, "prompt").mockReturnValue("");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.listeners["oauth-window-closed"]).toBeDefined());
    act(() => mocks.listeners["telemost-macos-auth-required"]({ payload: "auth=REQUIRED;surface=check" }));
    act(() => mocks.listeners["oauth-window-closed"]({ payload: "" }));
    expect(screen.getByText("Для входа во встречу через ваш Яндекс ID требуется авторизация.")).toBeInTheDocument();
    expect(await screen.findByText("Создайте новую встречу или подключитесь по ссылке.")).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.objectContaining({
      url: RECENT_URL,
    }));
    expect(sessionStorage.getItem("office360_telemost_pending_join:account-1")).toBeNull();
  });

  it("does not join when Passport identity does not match the Office360 account", async () => {
    mocks.createConference.mockResolvedValue({
      id: "new-1", title: null, joinUrl: RECENT_URL, organizer: null,
      createdAt: null, scheduledAt: null, status: null, liveStreamWatchUrl: null,
    });
    vi.spyOn(window, "prompt").mockReturnValue("");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.listeners["telemost-macos-auth-authenticated"]).toBeDefined());
    act(() => mocks.listeners["telemost-macos-auth-authenticated"]({
      payload: "auth=AUTHENTICATED;uid=9;login=other@yandex.ru;surface=check",
    }));
    expect(screen.getByText(/В Яндекс ID выбран другой аккаунт/)).toBeInTheDocument();
    expect(await screen.findByText("Создайте новую встречу или подключитесь по ссылке.")).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.objectContaining({
      url: RECENT_URL,
    }));
  });

  it("opens CONNECT guest /j/ without Passport bootstrap", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: RECENT_URL, accountKey: "account-1", bounds: SURFACE_BOUNDS,
    }));
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_oauth_login_window", expect.anything());
    expect(sessionStorage.getItem("office360_telemost_pending_join:account-1")).toBeNull();
  });

  it("reveals official Passport when auth is required during personal create", async () => {
    localStorage.setItem("office360_telemost_capability:account-1", "WEB_ONLY");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.listeners["telemost-macos-auth-required"]).toBeDefined());
    expect(screen.getByLabelText("Создаём встречу")).toBeInTheDocument();
    act(() => mocks.listeners["telemost-macos-auth-required"]({ payload: "" }));
    expect(screen.getByLabelText("Создаём встречу")).toBeInTheDocument();
    expect(screen.getByText("Нужен вход в Яндекс ID. Гостевая встреча не создаётся.")).toBeInTheDocument();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_oauth_login_window", expect.objectContaining({
      purpose: "passport-bootstrap",
      accountKey: "account-1",
    })));
    expect(mocks.openUrl).not.toHaveBeenCalled();
    expect(mocks.cefCreate).not.toHaveBeenCalled();
  });

  it("keeps CREATE covered after auth-required and does not reveal guest HOME", async () => {
    localStorage.setItem("office360_telemost_capability:account-1", "WEB_ONLY");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.listeners["telemost-macos-auth-required"]).toBeDefined());
    expect(mocks.listeners["telemost-macos-auth-resumed"]).toBeDefined();
    act(() => mocks.listeners["telemost-macos-auth-required"]({ payload: "" }));
    expect(screen.getByLabelText("Создаём встречу")).toBeInTheDocument();
    expect(screen.queryByText("Тарифы для бизнеса")).not.toBeInTheDocument();
    act(() => mocks.listeners["telemost-macos-auth-resumed"]({ payload: "" }));
    expect(screen.getByLabelText("Создаём встречу")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Тарифы для бизнеса");
  });

  it("requests progressive consent and retries meeting creation", async () => {
    mocks.hasGrantScopes.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mocks.createConference.mockResolvedValue({ id: "new-1", title: null, joinUrl: RECENT_URL, organizer: null, createdAt: null, scheduledAt: null, status: null, liveStreamWatchUrl: null });
    vi.spyOn(window, "prompt").mockReturnValue("");
    await renderReady();

    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    expect(await screen.findByText("Чтобы создавать встречи в Office360, разрешите доступ к Телемосту.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Client Secret");
    fireEvent.click(screen.getByRole("button", { name: "Разрешить доступ" }));

    await waitFor(() => expect(mocks.authorizeGrant).toHaveBeenCalledWith("account-1", "communications"));
    await waitFor(() => expect(mocks.createConference).toHaveBeenCalled());
  });

  it("falls back to the official WKWebView create surface on organization restriction", async () => {
    const { TelemostApiError } = await import("@/services/yandex360/telemost");
    mocks.createConference.mockRejectedValueOnce(new TelemostApiError("organization_restricted", "technical 403"));
    vi.spyOn(window, "prompt").mockReturnValue("");
    await renderReady();

    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: "https://telemost.yandex.ru/?browser-auto-create=1",
      accountKey: "account-1",
      bounds: SURFACE_BOUNDS,
    }));
    expect(mocks.createMeetingWeb).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_create", expect.anything());
    expect(document.body.textContent).not.toContain("technical 403");
    expect(mocks.cefCreate).not.toHaveBeenCalled();
    expect(mocks.createConference).toHaveBeenCalledTimes(1);
    expect(mocks.authorizeGrant).not.toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Создаём встречу")).toBeInTheDocument();
    expect(screen.queryByLabelText("Поверхность встречи Телемоста")).not.toBeInTheDocument();
  });

  it("captures a WKWebView create-flow join URL into meeting mode", async () => {
    localStorage.setItem("office360_telemost_capability:account-1", "WEB_ONLY");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: "https://telemost.yandex.ru/?browser-auto-create=1",
      accountKey: "account-1",
      bounds: SURFACE_BOUNDS,
    }));
    await waitFor(() => expect(mocks.listeners["telemost-macos-created"]).toBeDefined());
    mocks.invoke.mockClear();
    act(() => mocks.listeners["telemost-macos-created"]({ payload: RECENT_URL }));
    expect(await screen.findByText("Видеовстреча")).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_create", expect.anything());
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.objectContaining({ url: RECENT_URL }));
    expect(mocks.createMeetingWeb).not.toHaveBeenCalled();
    expect(mocks.cefCreate).not.toHaveBeenCalled();
  });

  it("does not reopen the same join URL when create emits twice", async () => {
    localStorage.setItem("office360_telemost_capability:account-1", "WEB_ONLY");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.listeners["telemost-macos-created"]).toBeDefined());
    act(() => mocks.listeners["telemost-macos-created"]({ payload: RECENT_URL }));
    mocks.invoke.mockClear();
    act(() => mocks.listeners["telemost-macos-created"]({ payload: RECENT_URL }));
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.anything());
  });

  it("returns to Office360 idle after leave and does not keep Telemost HOME", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", expect.anything()));
    await waitFor(() => expect(mocks.listeners["telemost-macos-left"]).toBeDefined());
    mocks.invoke.mockClear();
    act(() => mocks.listeners["telemost-macos-left"]({ payload: "" }));
    expect(await screen.findByText("Создайте новую встречу или подключитесь по ссылке.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Поверхность встречи Телемоста")).not.toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith("close_telemost_macos_embedded");
    expect(mocks.openUrl).not.toHaveBeenCalled();
    expect(mocks.cefCreate).not.toHaveBeenCalled();
  });

  it("starts a fresh personal create from idle after leave", async () => {
    localStorage.setItem("office360_telemost_capability:account-1", "WEB_ONLY");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.listeners["telemost-macos-created"]).toBeDefined());
    act(() => mocks.listeners["telemost-macos-created"]({ payload: RECENT_URL }));
    expect(await screen.findByLabelText("Поверхность встречи Телемоста")).toBeInTheDocument();
    act(() => mocks.listeners["telemost-macos-left"]({ payload: "" }));
    expect(await screen.findByText("Создайте новую встречу или подключитесь по ссылке.")).toBeInTheDocument();
    mocks.invoke.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_embedded", {
      url: "https://telemost.yandex.ru/?browser-auto-create=1",
      accountKey: "account-1",
      bounds: SURFACE_BOUNDS,
    }));
    expect(screen.getByLabelText("Создаём встречу")).toBeInTheDocument();
  });

  // Cross-account ownership is enforced Rust-side via should_close_owned_surface.
  // Same-account CREATE-after-JOIN now reuses the right-pane embedded surface
  // instead of opening open_telemost_macos_create.

  it("deletes an API-created meeting after confirmation and keeps others", async () => {
    localStorage.setItem("office360_telemost_conferences:account-1", JSON.stringify([
      {
        id: "3320691266", title: "Новая встреча", joinUrl: "https://telemost.360.yandex.ru/j/3320691266",
        organizer: null, createdAt: 1, scheduledAt: null, status: null, liveStreamWatchUrl: null,
        lastOpenedAt: null, source: "API_CREATED", remoteConferenceId: "3320691266",
      },
      {
        id: "111", title: "Другая встреча", joinUrl: "https://telemost.360.yandex.ru/j/111",
        organizer: null, createdAt: 1, scheduledAt: null, status: null, liveStreamWatchUrl: null,
        lastOpenedAt: null, source: "API_CREATED", remoteConferenceId: "111",
      },
    ]));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderReady();
    const meetingButton = await screen.findByRole("button", { name: /Новая встреча/ });
    fireEvent.click(within(meetingButton.closest("article")!).getByRole("button", { name: "Удалить встречу" }));
    await waitFor(() => expect(mocks.deleteConference).toHaveBeenCalledWith("account-1", "3320691266"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Новая встреча/ })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Другая встреча/ })).toBeInTheDocument();
  });

  it("keeps the meeting card when delete is forbidden", async () => {
    const { TelemostApiError } = await import("@/services/yandex360/telemost");
    localStorage.setItem("office360_telemost_conferences:account-1", JSON.stringify([{
      id: "3320691266", title: "Новая встреча", joinUrl: "https://telemost.360.yandex.ru/j/3320691266",
      organizer: null, createdAt: 1, scheduledAt: null, status: null, liveStreamWatchUrl: null,
      lastOpenedAt: null, source: "API_CREATED", remoteConferenceId: "3320691266",
    }]));
    mocks.deleteConference.mockRejectedValueOnce(new TelemostApiError("missing_scope", "insufficient scope"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Удалить встречу" }));
    await waitFor(() => expect(mocks.deleteConference).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Новая встреча/ })).toBeInTheDocument();
    expect(screen.getByText("Чтобы удалять встречи, разрешите доступ к Телемосту повторно.")).toBeInTheDocument();
  });
});

describe("Telemost Windows regression safety", () => {
  it("keeps the embedded CEF flow and does not use the opener", async () => {
    mocks.platform = "windows";
    render(<TelemostPage />);

    await waitFor(() => expect(mocks.cefInitialize).toHaveBeenCalled());
    expect(mocks.cefCreate).toHaveBeenCalledWith("https://telemost.yandex.ru/", "account-1");
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });
});
