import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddImapAccount } from "./AddImapAccount";
import { getOAuthProvider } from "@/services/oauth/providers";
import { startProviderOAuthFlow } from "@/services/oauth/oauthFlow";
import { insertOAuthImapAccount } from "@/services/db/accounts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("@/services/db/accounts", () => ({
  getAccountByEmail: vi.fn().mockResolvedValue(null),
  insertImapAccount: vi.fn(),
  insertOAuthImapAccount: vi.fn(),
  updateOAuthImapAccount: vi.fn(),
}));

vi.mock("@/services/db/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/oauth/oauthFlow", async () => {
  const actual = await vi.importActual<typeof import("@/services/oauth/oauthFlow")>(
    "@/services/oauth/oauthFlow",
  );
  return { ...actual, startProviderOAuthFlow: vi.fn() };
});

vi.mock("@/services/oauth/providers", async () => {
  const actual = await vi.importActual<typeof import("@/services/oauth/providers")>(
    "@/services/oauth/providers",
  );
  return { ...actual, getOAuthProvider: vi.fn(actual.getOAuthProvider) };
});

const yandexPreset = {
  providerId: "yandex",
  title: "Подключить через Яндекс ID",
  defaultEmail: "user@yandex.ru",
  description: "Managed Yandex OAuth",
};

function renderManagedYandex() {
  render(
    <AddImapAccount
      onClose={() => {}}
      onSuccess={() => {}}
      onBack={() => {}}
      oauthPreset={yandexPreset}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  const actualProvider = {
    id: "yandex",
    name: "Яндекс ID",
    authUrl: "https://oauth.yandex.ru/authorize",
    tokenUrl: "https://oauth.yandex.ru/token",
    scopes: [
      "login:email",
      "login:info",
      "login:avatar",
      "mail:imap_full",
      "mail:smtp",
      "calendar:all",
    ],
    publicClientId: "managed-yandex-client",
    userInfoUrl: "https://login.yandex.ru/info?format=json",
    userInfoAuthScheme: "OAuth" as const,
    usePkce: true,
  };
  vi.mocked(getOAuthProvider).mockReturnValue(actualProvider);
  vi.mocked(startProviderOAuthFlow).mockResolvedValue({
    tokens: {
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
      scope: actualProvider.scopes.join(" "),
    },
    userInfo: { email: "user@yandex.ru", name: "User" },
  });
});

describe("managed Yandex account OAuth", () => {
  it("does not render Client ID, Client Secret, tokens, or developer-console instructions", () => {
    renderManagedYandex();

    expect(screen.queryByText(/Client ID/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Client Secret/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/OAuth token/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/кабинета OAuth-приложения|developer console/i)).not.toBeInTheDocument();
  });

  it("starts the existing PKCE provider flow with the managed client and no secret", async () => {
    renderManagedYandex();
    fireEvent.change(screen.getByLabelText("Email Address"), {
      target: { value: "user@yandex.ru" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Войти через Яндекс ID" }));

    await waitFor(() => {
      expect(startProviderOAuthFlow).toHaveBeenCalledWith(
        expect.objectContaining({ id: "yandex", usePkce: true }),
        "managed-yandex-client",
        undefined,
      );
    });
  });

  it("shows a dev configuration error instead of credential fields when the managed client is missing", () => {
    vi.mocked(getOAuthProvider).mockReturnValue({
      id: "yandex",
      name: "Яндекс ID",
      authUrl: "https://oauth.yandex.ru/authorize",
      tokenUrl: "https://oauth.yandex.ru/token",
      scopes: [],
      usePkce: true,
    });

    renderManagedYandex();

    expect(screen.getByText("Конфигурация Яндекс OAuth отсутствует в dev environment.")).toBeInTheDocument();
    expect(screen.queryByText(/Client ID|Client Secret/i)).not.toBeInTheDocument();
  });

  it("saves a corporate Yandex 360 mailbox with .com IMAP/SMTP even when token.scope is empty", async () => {
    vi.mocked(insertOAuthImapAccount).mockResolvedValue(undefined as never);
    vi.mocked(startProviderOAuthFlow).mockResolvedValue({
      tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
      },
      userInfo: { email: "korotkov.g@office-360.ru", name: "Georgy" },
    });

    renderManagedYandex();
    fireEvent.change(screen.getByLabelText("Email Address"), {
      target: { value: "korotkov.g@office-360.ru" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Войти через Яндекс ID" }));

    await waitFor(() => {
      expect(insertOAuthImapAccount).toHaveBeenCalled();
    });
    expect(insertOAuthImapAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "korotkov.g@office-360.ru",
        imapHost: "imap.yandex.com",
        imapPort: 993,
        smtpHost: "smtp.yandex.com",
        smtpPort: 465,
        imapUsername: "korotkov.g@office-360.ru",
      }),
    );
    expect(screen.queryByText(/mail permissions are missing|нет прав на почту/i)).not.toBeInTheDocument();
  });

  it("shows missing-scope copy only when the token lists non-mail scopes", async () => {
    vi.mocked(startProviderOAuthFlow).mockResolvedValue({
      tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "login:email login:info",
      },
      userInfo: { email: "korotkov.g@office-360.ru", name: "Georgy" },
    });

    renderManagedYandex();
    fireEvent.change(screen.getByLabelText("Email Address"), {
      target: { value: "korotkov.g@office-360.ru" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Войти через Яндекс ID" }));

    await waitFor(() => {
      expect(screen.getByText("Yandex ID connected, but mail permissions are missing.")).toBeInTheDocument();
    });
    expect(insertOAuthImapAccount).not.toHaveBeenCalled();
  });
});
