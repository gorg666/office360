import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TasksSettingsPanel } from "./TasksSettingsPanel";

const get = vi.fn();
const upsert = vi.fn();
const listQueues = vi.fn();
const capabilities = vi.fn();

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: (sel: (s: { accounts: Array<{ id: string; isActive: boolean }> }) => unknown) =>
    sel({ accounts: [{ id: "acc", isActive: true }] }),
}));

vi.mock("@/services/yandex/accountApi", () => ({
  getStoredYandexOrgId: vi.fn().mockResolvedValue("org-1"),
}));

vi.mock("@/services/tasks/organizationTaskSettings", () => ({
  getOrganizationTaskSettings: (...args: unknown[]) => get(...args),
  upsertOrganizationTaskSettings: (...args: unknown[]) => upsert(...args),
}));

vi.mock("@/services/tasks/mailCreateFlow", () => ({
  createDefaultTrackerProvider: () => ({
    id: "yandex-tracker",
    capabilities: (...a: unknown[]) => capabilities(...a),
    listQueues: (...a: unknown[]) => listQueues(...a),
  }),
}));

vi.mock("@/services/tasks/taskRepository", () => ({
  SqliteTaskRepository: class {},
}));

describe("TasksSettingsPanel", () => {
  beforeEach(() => {
    get.mockReset();
    upsert.mockReset();
    listQueues.mockReset();
    capabilities.mockReset();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    get.mockResolvedValue({
      organizationId: "org-1",
      provider: "yandex-tracker",
      enabled: true,
      providerOrganizationId: "42",
      defaultQueue: null,
      updatedAt: 1,
    });
    capabilities.mockResolvedValue({
      read: true,
      write: true,
      create: true,
      update: true,
      transitions: true,
      assign: true,
      organizationDirectoryBinding: true,
    });
    listQueues.mockResolvedValue([
      { id: "1", key: "TEST", displayName: "Test queue" },
      { id: "2", key: "DEV", displayName: "Dev" },
    ]);
    upsert.mockImplementation(async (row: unknown) => row);
  });

  it("loads queues and saves default queue without secrets", async () => {
    render(<TasksSettingsPanel />);
    await waitFor(() => expect(listQueues).toHaveBeenCalled());
    expect(screen.getByText(/Test queue/i)).toBeTruthy();

    const select = screen.getByLabelText(/Очередь Tracker по умолчанию/i);
    fireEvent.change(select, { target: { value: "TEST" } });
    fireEvent.click(screen.getByRole("button", { name: /Сохранить/i }));

    await waitFor(() => expect(upsert).toHaveBeenCalled());
    const saved = upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.defaultQueue).toBe("TEST");
    expect(saved.organizationId).toBe("org-1");
    expect(JSON.stringify(saved)).not.toMatch(/oauth|token|secret|password/i);
  });

  it("shows offline queue discovery state", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    render(<TasksSettingsPanel />);
    await waitFor(() =>
      expect(screen.getByText(/Офлайн/i)).toBeTruthy(),
    );
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });
});
