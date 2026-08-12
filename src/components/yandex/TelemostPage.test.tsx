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
  createConference: vi.fn(),
  getCalendarEvents: vi.fn(),
  invoke: vi.fn(),
  listeners: {} as Record<string, (event: { payload: string }) => void>,
  navigateToLabel: vi.fn(),
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
}));
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
  mocks.getCalendarEvents.mockResolvedValue([]);
  mocks.invoke.mockResolvedValue(undefined);
  mocks.listeners = {};
  localStorage.clear();
  sessionStorage.clear();
});

describe("Telemost native macOS shell", () => {
  it("does not initialize CEF or show a generic Yandex web home", async () => {
    await renderReady();

    expect(mocks.cefInitialize).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Встречи внутри Office360");
    expect(document.body.textContent).not.toContain("Телемост откроется в браузере");
    expect(document.body.textContent).not.toContain("Windows x64");
    expect(document.body.textContent).not.toContain("CEF");
  });

  it("uses a native join dialog and opens only the meeting URL internally", async () => {
    await renderReady();

    fireEvent.click(screen.getByRole("button", { name: "Подключиться" }));
    fireEvent.change(screen.getByLabelText("Ссылка на встречу"), { target: { value: RECENT_URL } });
    fireEvent.click(screen.getByRole("dialog").querySelector("button.btn-primary")!);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_spike", { url: RECENT_URL }));
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("opens a recent meeting URL in the macOS meeting surface", async () => {
    localStorage.setItem("office360_telemost_visited:account-1", JSON.stringify([{
      id: "123456789",
      title: "Недавняя встреча",
      joinUrl: RECENT_URL,
      source: "visited",
    }]));
    await renderReady();
    const recentMeeting = await screen.findByRole("button", { name: /Недавняя встреча/ });

    fireEvent.click(recentMeeting);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_spike", { url: RECENT_URL }));
    expect(mocks.cefNavigate).not.toHaveBeenCalled();
  });

  it("opens an existing calendar meeting URL in the macOS meeting surface", async () => {
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

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_spike", { url: RECENT_URL }));
    expect(mocks.cefNavigate).not.toHaveBeenCalled();
  });

  it("preserves a localized browser fallback when the meeting surface fails", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("WKWebView unavailable"));
    mocks.openUrl.mockRejectedValueOnce(new Error("opener unavailable"));
    await renderReady();
    fireEvent.change(screen.getByLabelText("Экспериментальная ссылка Телемоста"), { target: { value: RECENT_URL } });

    fireEvent.click(screen.getByRole("button", { name: "Открыть внутри Office360 (экспериментально)" }));

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
  });

  it("opens a real meeting URL in the experimental macOS WKWebView path", async () => {
    await renderReady();
    fireEvent.change(screen.getByLabelText("Экспериментальная ссылка Телемоста"), { target: { value: RECENT_URL } });

    fireEvent.click(screen.getByRole("button", { name: "Открыть внутри Office360 (экспериментально)" }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_telemost_macos_spike", { url: RECENT_URL }));
    expect(mocks.cefInitialize).not.toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();
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
