import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Yandex360AccountHub } from "./Yandex360AccountHub";
import { getAllAccounts } from "@/services/db/accounts";
import { listAccountDiagnostics } from "@/services/db/accountDiagnostics";
import { createMockDbAccount } from "@/test/mocks";
import { getYandexUnifiedAuthStatus } from "@/services/oauth/yandexUnifiedAuth";

vi.mock("@/services/db/accounts", () => ({
  getAllAccounts: vi.fn(),
}));

vi.mock("@/services/db/accountDiagnostics", () => ({
  listAccountDiagnostics: vi.fn(),
}));

vi.mock("@/router/navigate", () => ({
  navigateToRepairCenter: vi.fn(),
}));

vi.mock("@/services/oauth/yandexUnifiedAuth", async () => {
  const actual = await vi.importActual<typeof import("@/services/oauth/yandexUnifiedAuth")>(
    "@/services/oauth/yandexUnifiedAuth",
  );
  return {
    ...actual,
    getYandexUnifiedAuthStatus: vi.fn(),
    authorizeYandexGrant: vi.fn(),
    authorizeYandexSuite: vi.fn(),
  };
});

describe("Yandex360AccountHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAccountDiagnostics).mockResolvedValue([]);
  });

  it("shows ordinary Yandex ID onboarding without raw admin token UX", async () => {
    vi.mocked(getAllAccounts).mockResolvedValue([]);

    render(<Yandex360AccountHub />);

    expect(await screen.findByText("Яндекс 360 аккаунт не подключен")).toBeInTheDocument();
    expect(screen.getByText(/Добавьте почтовый аккаунт через Яндекс ID/i)).toBeInTheDocument();
    expect(screen.queryByText(/OAuth-токен Яндекс 360/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /выполнить запрос/i })).not.toBeInTheDocument();
  });

  it("shows connected work account service readiness", async () => {
    vi.mocked(getAllAccounts).mockResolvedValue([
      createMockDbAccount({
        id: "yandex-1",
        email: "user@company.ru",
        display_name: "Yandex User",
        provider: "imap",
        auth_method: "oauth2",
        oauth_provider: "yandex",
        access_token: "access",
        refresh_token: "refresh",
        oauth_client_id: "client",
        oauth_granted_scopes: "login:email mail:imap_full mail:smtp calendar:all",
        calendar_provider: "caldav",
        caldav_url: "https://caldav.yandex.ru",
      }),
    ]);
    vi.mocked(getYandexUnifiedAuthStatus).mockResolvedValue([
      { id: "core", label: "Почта", connected: true, elevated: false, scopes: [], statusLabel: "CONNECTED" },
      { id: "work", label: "Диск и Трекер", connected: true, elevated: false, scopes: [], statusLabel: "CONNECTED" },
      { id: "communications", label: "Мессенджер и Телемост", connected: false, elevated: false, scopes: [], statusLabel: "NEEDS ACCESS" },
      { id: "admin", label: "Администрирование", connected: false, elevated: true, scopes: [], statusLabel: "ERROR" },
    ]);

    render(<Yandex360AccountHub />);

    expect(await screen.findByText("Yandex User")).toBeInTheDocument();
    expect(screen.getByText("user@company.ru")).toBeInTheDocument();
    expect(screen.getAllByText("Почта").length).toBeGreaterThan(0);
    expect(screen.getByText("Календарь")).toBeInTheDocument();
    expect(screen.getAllByText("Мессенджер").length).toBeGreaterThan(0);
    expect(screen.getByText("Задачи")).toBeInTheDocument();
    expect(screen.getAllByText(/Мессенджер и Телемост/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/future|capability|slice|guardrails/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /исправить/i })).toBeInTheDocument();
  });

  it("renders grant statuses in Russian", async () => {
    vi.mocked(getAllAccounts).mockResolvedValue([
      createMockDbAccount({
        id: "yandex-1",
        email: "user@company.ru",
        display_name: "Yandex User",
        provider: "imap",
        auth_method: "oauth2",
        oauth_provider: "yandex",
        access_token: "access",
        refresh_token: "refresh",
        oauth_client_id: "client",
        oauth_granted_scopes: "login:email mail:imap_full mail:smtp calendar:all",
        calendar_provider: "caldav",
        caldav_url: "https://caldav.yandex.ru",
      }),
    ]);
    vi.mocked(getYandexUnifiedAuthStatus).mockResolvedValue([
      { id: "core", label: "Почта", connected: true, elevated: false, scopes: [], statusLabel: "CONNECTED" },
      { id: "work", label: "Диск и Трекер", connected: true, elevated: false, scopes: [], statusLabel: "CONNECTED" },
      { id: "communications", label: "Мессенджер и Телемост", connected: false, elevated: false, scopes: [], statusLabel: "NEEDS ACCESS" },
      { id: "admin", label: "Администрирование", connected: false, elevated: true, scopes: [], statusLabel: "ERROR" },
    ]);

    render(<Yandex360AccountHub />);

    await waitFor(() => expect(screen.getAllByText("Подключено").length).toBeGreaterThan(0));
    expect(screen.getByText("Требуется доступ")).toBeInTheDocument();
    expect(screen.getByText("Ошибка")).toBeInTheDocument();
    expect(screen.queryByText("CONNECTED")).not.toBeInTheDocument();
    expect(screen.queryByText("NEEDS ACCESS")).not.toBeInTheDocument();
    expect(screen.queryByText(/^ERROR$/)).not.toBeInTheDocument();
  });

  it("surfaces missing scopes with reauth action", async () => {
    vi.mocked(getAllAccounts).mockResolvedValue([
      createMockDbAccount({
        id: "yandex-1",
        email: "user@company.ru",
        display_name: "Yandex User",
        provider: "imap",
        auth_method: "oauth2",
        oauth_provider: "yandex",
        access_token: "access",
        refresh_token: "refresh",
        oauth_client_id: "client",
        oauth_granted_scopes: "login:email mail:imap_full calendar:all",
        calendar_provider: "caldav",
        caldav_url: "https://caldav.yandex.ru",
      }),
    ]);
    vi.mocked(getYandexUnifiedAuthStatus).mockResolvedValue([]);

    render(<Yandex360AccountHub />);

    await waitFor(() => expect(screen.getByText(/mail:smtp/)).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /обновить вход/i }).length).toBeGreaterThan(0);
  });
});
