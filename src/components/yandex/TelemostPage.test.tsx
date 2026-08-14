import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopPlatform } from "@/utils/desktopPlatform";

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
  await screen.findByText("Встречи внутри Office360");
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
  mocks.invoke.mockResolvedValue(undefined);
  mocks.hasGrantScopes.mockResolvedValue(true);
  mocks.authorizeGrant.mockResolvedValue(undefined);
  mocks.createMeetingWeb.mockResolvedValue("wkwebview");
  mocks.listeners = {};
  localStorage.clear();
  sessionStorage.clear();
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
    expect(document.body.textContent).toContain("Встречи внутри Office360");
    expect(document.body.textContent).not.toContain("Телемост откроется в браузере");
    expect(document.body.textContent).not.toContain("Windows x64");
  });

  it("mounts CEF in the right pane with container bounds", async () => {
    await renderReady();

    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);

    await waitFor(() => expect(mocks.cefCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/passport\.yandex\.ru\/auth\?/),
      "account-1",
    ));
    expect(mocks.cefSetBounds).toHaveBeenCalledWith(expect.objectContaining(SURFACE_BOUNDS));
    expect(screen.getByText("Встречи")).toBeInTheDocument();
    expect(screen.getByLabelText("Поверхность встречи Телемоста")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Закрыть встречу/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Скопировать ссылку/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Открыть в браузере$/ })).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.anything());
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("opens a recent meeting URL in the right-pane CEF surface", async () => {
    localStorage.setItem("office360_telemost_visited:account-1", JSON.stringify([{
      id: "123456789",
      title: "Недавняя встреча",
      joinUrl: RECENT_URL,
      source: "visited",
    }]));
    await renderReady();
    const recentMeeting = await screen.findByRole("button", { name: /Недавняя встреча/ });

    fireEvent.click(recentMeeting);

    await waitFor(() => expect(mocks.cefCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/passport\.yandex\.ru\/auth\?/),
      "account-1",
    ));
    expect(screen.getByText("Встречи")).toBeInTheDocument();
    expect(screen.getByLabelText("Поверхность встречи Телемоста")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Закрыть встречу/ })).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.anything());
  });

  it("opens an existing calendar meeting URL in the right-pane CEF surface", async () => {
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

    await waitFor(() => expect(mocks.cefCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/passport\.yandex\.ru\/auth\?/),
      "account-1",
    ));
    expect(screen.getByText("Встречи")).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.anything());
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
    await waitFor(() => expect(mocks.cefCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/passport\.yandex\.ru\/auth\?/),
      "account-1",
    ));

    expect(screen.getByLabelText("Поверхность встречи Телемоста")).toBeInTheDocument();
    expect(screen.getByText("Встречи")).toBeInTheDocument();
    expect(screen.queryByText("Встречи внутри Office360")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Закрыть встречу/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Скопировать ссылку/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Открыть в браузере$/ })).not.toBeInTheDocument();
  });

  it("shows retry and browser fallback only in the error state when CEF create fails", async () => {
    mocks.cefCreate.mockRejectedValueOnce(new Error("CEF unavailable"));
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);

    expect(await screen.findByText("Не удалось открыть видеовстречу внутри приложения.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Открыть в браузере" })).toBeInTheDocument();
    expect(mocks.openUrl).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_spike", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "Открыть в браузере" }));
    await waitFor(() => expect(mocks.openUrl).toHaveBeenCalledWith(RECENT_URL));
  });

  it("preserves a localized browser fallback when CEF and opener both fail", async () => {
    mocks.cefCreate.mockRejectedValueOnce(new Error("CEF unavailable"));
    mocks.openUrl.mockRejectedValueOnce(new Error("opener unavailable"));
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);

    expect(await screen.findByText("Не удалось открыть видеовстречу внутри приложения.")).toBeInTheDocument();
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

  it("opens a real meeting URL through right-pane CEF", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);

    await waitFor(() => expect(mocks.cefCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/passport\.yandex\.ru\/auth\?/),
      "account-1",
    ));
    expect(screen.getByText("Встречи")).toBeInTheDocument();
    expect(screen.getByLabelText("Поверхность встречи Телемоста")).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith("open_telemost_macos_embedded", expect.anything());
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("destroys CEF before switching Telemost account", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);
    await waitFor(() => expect(mocks.cefCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/passport\.yandex\.ru\/auth\?/),
      "account-1",
    ));
    fireEvent.click(screen.getByRole("button", { name: "Сменить аккаунт Телемоста" }));

    await waitFor(() => expect(mocks.cefResetAccountProfile).toHaveBeenCalledWith("account-1"));
    expect(mocks.cefCloseBrowser).toHaveBeenCalled();
    await waitFor(() => expect(mocks.cefCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/passport\.yandex\.ru\/auth\?/),
      "account-1",
    ));
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

  it("switches an exact organization restriction to right-pane CEF create", async () => {
    const { TelemostApiError } = await import("@/services/yandex360/telemost");
    mocks.createConference.mockRejectedValueOnce(new TelemostApiError("organization_restricted", "technical 403"));
    vi.spyOn(window, "prompt").mockReturnValue("");
    await renderReady();

    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.cefCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/passport\.yandex\.ru\/auth\?/),
      "account-1",
    ));
    expect(document.body.textContent).not.toContain("technical 403");
    expect(screen.getByText("Встречи")).toBeInTheDocument();
    expect(screen.getByLabelText("Поверхность встречи Телемоста")).toBeInTheDocument();
    expect(mocks.createMeetingWeb).not.toHaveBeenCalled();
    expect(mocks.createConference).toHaveBeenCalledTimes(1);
    expect(mocks.authorizeGrant).not.toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("captures a CEF create-flow join URL into meeting mode", async () => {
    localStorage.setItem("office360_telemost_capability:account-1", "WEB_ONLY");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Новая видеовстреча" }));
    await waitFor(() => expect(mocks.cefCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/passport\.yandex\.ru\/auth\?/),
      "account-1",
    ));
    await waitFor(() => expect(mocks.listeners["cef-event"]).toBeDefined());
    act(() => mocks.listeners["cef-event"]({ payload: { type: "navigation", payload: { url: RECENT_URL } } } as never));
    expect(await screen.findByText("Видеовстреча")).toBeInTheDocument();
    expect(screen.getByLabelText("Поверхность встречи Телемоста")).toBeInTheDocument();
    expect(screen.getByText("Встречи")).toBeInTheDocument();
    await waitFor(() => expect(mocks.cefCreate).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/passport\.yandex\.ru\/auth\?/),
      "account-1",
    ));
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
