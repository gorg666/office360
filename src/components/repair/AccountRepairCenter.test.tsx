import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountRepairCenter } from "./AccountRepairCenter";
import { getAllAccounts } from "@/services/db/accounts";
import { listAccountDiagnostics } from "@/services/db/accountDiagnostics";
import { collectSupportDebugBundle, saveSupportDebugBundle } from "@/services/diagnostics";
import { listAccountSyncHealth } from "@/services/syncHealth";

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({}),
}));

vi.mock("@/services/db/accounts", () => ({
  getAllAccounts: vi.fn(),
  getAccount: vi.fn(),
  updateOAuthImapAccount: vi.fn(),
}));

vi.mock("@/services/db/accountDiagnostics", () => ({
  clearAccountDiagnostic: vi.fn(),
  listAccountDiagnostics: vi.fn(),
}));

vi.mock("@/services/diagnostics", () => ({
  collectSupportDebugBundle: vi.fn(),
  saveSupportDebugBundle: vi.fn(),
}));

vi.mock("@/services/syncHealth", () => ({
  listAccountSyncHealth: vi.fn(),
  syncHealthStatusLabel: (status: string) => status,
}));

vi.mock("@/services/gmail/syncManager", () => ({
  triggerSync: vi.fn(),
}));

vi.mock("@/services/gmail/tokenManager", () => ({
  reauthorizeAccount: vi.fn(),
}));

vi.mock("@/services/oauth/providers", () => ({
  getOAuthProvider: vi.fn(),
}));

vi.mock("@/services/oauth/oauthFlow", () => ({
  startProviderOAuthFlow: vi.fn(),
}));

vi.mock("@/router/navigate", () => ({
  navigateBackFromRepair: vi.fn(),
  navigateToLabel: vi.fn(),
  navigateToSettings: vi.fn(),
}));

describe("AccountRepairCenter support bundle export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllAccounts).mockResolvedValue([{
      id: "acc-1",
      email: "user@example.com",
      display_name: "User",
      avatar_url: null,
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      history_id: null,
      last_sync_at: null,
      is_active: 1,
      provider: "imap",
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_security: "tls",
      smtp_host: "smtp.example.com",
      smtp_port: 465,
      smtp_security: "tls",
      auth_method: "password",
      imap_password: null,
      oauth_provider: null,
      oauth_client_id: null,
      oauth_client_secret: null,
      imap_username: "user@example.com",
      accept_invalid_certs: 0,
      calendar_provider: null,
      caldav_url: null,
      caldav_username: null,
      caldav_password: null,
      caldav_principal_url: null,
      caldav_home_url: null,
      created_at: 1,
      updated_at: 1,
    }]);
    vi.mocked(listAccountDiagnostics).mockResolvedValue([]);
    vi.mocked(listAccountSyncHealth).mockResolvedValue([]);
    vi.mocked(collectSupportDebugBundle).mockResolvedValue({
      schemaVersion: 2,
      exportedAt: "2026-06-14T10:00:00.000Z",
      app: { name: "Office360 Mail", version: "0.4.21" },
      scope: { includeQueue: true, includeDiagnostics: true },
      accounts: [],
      diagnostics: [],
      syncHealth: [],
      queue: [],
      securityWarnings: [],
    });
    vi.mocked(saveSupportDebugBundle).mockResolvedValue({ path: "/tmp/support.json", fallback: false });
  });

  it("allows support bundle export when there are no diagnostics", async () => {
    render(<AccountRepairCenter />);

    const exportButton = await screen.findByRole("button", { name: /export support bundle/i });
    expect(exportButton).toBeEnabled();

    fireEvent.click(exportButton);

    await waitFor(() => expect(collectSupportDebugBundle).toHaveBeenCalledWith({ accountId: undefined }));
    await waitFor(() => expect(saveSupportDebugBundle).toHaveBeenCalled());
    expect(await screen.findByText("Support bundle saved to /tmp/support.json")).toBeInTheDocument();
  });
});
