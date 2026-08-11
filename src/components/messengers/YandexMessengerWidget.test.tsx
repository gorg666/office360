import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { YandexMessengerWidget } from "./YandexMessengerWidget";

const getYandexUnifiedAuthStatus = vi.fn();
const getYandexGrantAccessToken = vi.fn();
const authorizeYandexGrant = vi.fn();

vi.mock("@/services/oauth/yandexUnifiedAuth", () => ({
  getYandexUnifiedAuthStatus: (...args: unknown[]) => getYandexUnifiedAuthStatus(...args),
  getYandexGrantAccessToken: (...args: unknown[]) => getYandexGrantAccessToken(...args),
  authorizeYandexGrant: (...args: unknown[]) => authorizeYandexGrant(...args),
}));

const show = vi.fn();
const hide = vi.fn();
const mount = vi.fn();
const init = vi.fn(() => ({ show, hide }));
const setUI = vi.fn(() => ({ init }));
const createMultiChatsWidget = vi.fn(() => ({ setUI }));
const blockUIFactory = vi.fn(() => ({ mount }));

vi.mock("yandex-messenger-widget", () => ({
  blockUIFactory: () => blockUIFactory(),
  createMultiChatsWidget: (...args: unknown[]) => createMultiChatsWidget(...args),
}));

vi.mock("yandex-messenger-widget/lib/ui/block.css", () => ({}));

describe("YandexMessengerWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows Allow access CTA when communications grant needs access", async () => {
    getYandexUnifiedAuthStatus.mockResolvedValue([
      { id: "communications", label: "Мессенджер и Телемост", connected: false, elevated: false, scopes: [], statusLabel: "NEEDS ACCESS" },
    ]);

    render(<YandexMessengerWidget accountId="acc-1" />);

    expect(await screen.findByTestId("yandex-messenger-needs-access")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /разрешить доступ/i })).toBeInTheDocument();
    expect(createMultiChatsWidget).not.toHaveBeenCalled();
    expect(screen.queryByText(/bot token|client id|client secret/i)).not.toBeInTheDocument();
  });

  it("mounts widget when communications grant is connected", async () => {
    getYandexUnifiedAuthStatus.mockResolvedValue([
      { id: "communications", label: "Мессенджер и Телемост", connected: true, elevated: false, scopes: [], statusLabel: "CONNECTED" },
    ]);
    getYandexGrantAccessToken.mockResolvedValue("comm-access-token");

    render(<YandexMessengerWidget accountId="acc-1" />);

    await waitFor(() => expect(createMultiChatsWidget).toHaveBeenCalled());
    expect(createMultiChatsWidget).toHaveBeenCalledWith({
      serviceId: -1,
      authToken: "OAuth comm-access-token",
    });
    expect(mount).toHaveBeenCalled();
    expect(show).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("yandex-messenger-widget-host")).toHaveAttribute("data-mounted", "true"));
  });

  it("consent success remounts widget", async () => {
    getYandexUnifiedAuthStatus
      .mockResolvedValueOnce([
        { id: "communications", label: "Мессенджер и Телемост", connected: false, elevated: false, scopes: [], statusLabel: "NEEDS ACCESS" },
      ])
      .mockResolvedValueOnce([
        { id: "communications", label: "Мессенджер и Телемост", connected: true, elevated: false, scopes: [], statusLabel: "CONNECTED" },
      ]);
    authorizeYandexGrant.mockResolvedValue(undefined);
    getYandexGrantAccessToken.mockResolvedValue("after-consent-token");

    render(<YandexMessengerWidget accountId="acc-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /разрешить доступ/i }));

    await waitFor(() => expect(authorizeYandexGrant).toHaveBeenCalledWith("acc-1", "communications"));
    await waitFor(() => expect(createMultiChatsWidget).toHaveBeenCalledWith({
      serviceId: -1,
      authToken: "OAuth after-consent-token",
    }));
  });

  it("reloads grant state when account changes", async () => {
    getYandexUnifiedAuthStatus.mockResolvedValue([
      { id: "communications", label: "Мессенджер и Телемост", connected: false, elevated: false, scopes: [], statusLabel: "NEEDS ACCESS" },
    ]);

    const { rerender } = render(<YandexMessengerWidget accountId="acc-a" />);
    await screen.findByTestId("yandex-messenger-needs-access");
    expect(getYandexUnifiedAuthStatus).toHaveBeenCalledWith("acc-a");

    getYandexUnifiedAuthStatus.mockResolvedValue([
      { id: "communications", label: "Мессенджер и Телемост", connected: true, elevated: false, scopes: [], statusLabel: "CONNECTED" },
    ]);
    getYandexGrantAccessToken.mockResolvedValue("acc-b-token");
    rerender(<YandexMessengerWidget accountId="acc-b" />);

    await waitFor(() => expect(getYandexUnifiedAuthStatus).toHaveBeenCalledWith("acc-b"));
    await waitFor(() => expect(getYandexGrantAccessToken).toHaveBeenCalledWith("acc-b", "communications"));
  });
});
