import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAccount: vi.fn(), authStatus: vi.fn() }));
vi.mock("@/services/db/accounts", () => ({ getAccount: mocks.getAccount }));
vi.mock("@/services/oauth/yandexUnifiedAuth", () => ({ getYandexUnifiedAuthStatus: mocks.authStatus }));
vi.mock("@/services/yandex360/client", () => ({ yandex360Request: vi.fn() }));

import { mapYandexDirectoryUsers, Yandex360PeopleDirectoryProvider } from "./yandex360DirectoryProvider";

describe("Yandex 360 people directory mapping", () => {
  beforeEach(() => {
    mocks.getAccount.mockReset();
    mocks.authStatus.mockReset();
  });
  it("normalizes official directory name, email, position and department fields", () => {
    const people = mapYandexDirectoryUsers(
      { id: 42, name: "Acme" },
      [{ id: "7", email: "User@Example.com", name: { first: "Анна", last: "Иванова" }, position: "Архитектор", departmentId: 3 }],
      [{ id: 3, name: "Платформа" }],
    );
    expect(people).toEqual([expect.objectContaining({
      id: "yandex360:42:7",
      email: "User@Example.com",
      normalizedEmail: "user@example.com",
      displayName: "Анна Иванова",
      jobTitle: "Архитектор",
      organization: "Acme",
      department: "Платформа",
      source: "organization-directory",
    })]);
  });

  it("excludes dismissed, disabled, robot and addressless directory records", () => {
    const people = mapYandexDirectoryUsers({ id: 1 }, [
      { id: "1", email: "gone@example.com", isDismissed: true },
      { id: "2", email: "off@example.com", isEnabled: false },
      { id: "3", email: "robot@example.com", isRobot: true },
      { id: "4" },
    ]);
    expect(people).toEqual([]);
  });

  it("requires both organization and user read scopes for live directory search", async () => {
    mocks.getAccount.mockResolvedValue({ oauth_provider: "yandex", auth_method: "oauth2" });
    mocks.authStatus.mockResolvedValue([{ id: "admin", connected: true, scopes: ["directory:read_users"] }]);
    const provider = new Yandex360PeopleDirectoryProvider("account-1");
    await expect(provider.capability()).resolves.toBe("permission-denied");
    mocks.authStatus.mockResolvedValue([{
      id: "admin", connected: true,
      scopes: ["directory:read_organization", "directory:read_users"],
    }]);
    await expect(provider.capability()).resolves.toBe("supported");
  });
});
