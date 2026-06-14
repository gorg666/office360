import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsAboutPanel } from "./SettingsAboutPanel";
import { collectSupportDebugBundle, saveSupportDebugBundle } from "@/services/diagnostics";

vi.mock("@/services/diagnostics", () => ({
  collectSupportDebugBundle: vi.fn(),
  saveSupportDebugBundle: vi.fn(),
}));

vi.mock("@/services/updateManager", () => ({
  getAvailableUpdate: vi.fn(() => null),
  checkForUpdateNow: vi.fn(async () => null),
  installUpdate: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.4.21"),
  getTauriVersion: vi.fn(async () => "2.10.0"),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => "macos"),
  arch: vi.fn(() => "aarch64"),
}));

describe("SettingsAboutPanel support bundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.mocked(saveSupportDebugBundle).mockResolvedValue({ fallback: true });
  });

  it("exports a support bundle from About settings", async () => {
    render(<SettingsAboutPanel />);

    expect(screen.getByText("Support bundle")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(collectSupportDebugBundle).toHaveBeenCalledWith());
    await waitFor(() => expect(saveSupportDebugBundle).toHaveBeenCalled());
    expect(await screen.findByText("Support bundle downloaded with browser fallback.")).toBeInTheDocument();
  });
});
