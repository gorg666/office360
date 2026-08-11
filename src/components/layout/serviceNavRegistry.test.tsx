import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  assertServiceNavIconsComplete,
  SERVICE_NAV_REGISTRY,
} from "./serviceNavRegistry";
import { formatNavBadgeCount } from "./navBadgeFormat";
import { NavBadge } from "./NavBadge";

vi.mock("@/services/db/threads", () => ({
  getUnreadInboxCount: vi.fn(async () => 0),
  getUnreadInboxCountsByAccount: vi.fn(async () => ({})),
}));

vi.mock("@/services/db/pendingOperations", () => ({
  getOutboxSendCount: vi.fn(async () => 0),
}));

describe("serviceNavRegistry", () => {
  it("requires icon, stable id, and RU label for every entry", () => {
    expect(() => assertServiceNavIconsComplete()).not.toThrow();
    for (const item of SERVICE_NAV_REGISTRY) {
      expect(item.id).toBeTruthy();
      expect(item.icon).toBeTruthy();
      expect(item.label).toMatch(/[А-Яа-яЁё]/);
      expect(item.icon).not.toBeUndefined();
    }
  });

  it("covers required service routes", () => {
    const ids = new Set(SERVICE_NAV_REGISTRY.map((item) => item.id));
    for (const id of ["messengers", "tasks", "calendar", "attachments", "disk", "telemost", "tracker", "inbox"]) {
      expect(ids.has(id)).toBe(true);
    }
    expect(ids.has("contacts")).toBe(false);
  });

  it("wires mail unread / outbox / tasks badge sources", () => {
    expect(SERVICE_NAV_REGISTRY.find((i) => i.id === "inbox")?.badgeSource).toBe("mailInboxUnread");
    expect(SERVICE_NAV_REGISTRY.find((i) => i.id === "outbox")?.badgeSource).toBe("outboxSend");
    expect(SERVICE_NAV_REGISTRY.find((i) => i.id === "tasks")?.badgeSource).toBe("tasksIncomplete");
    expect(SERVICE_NAV_REGISTRY.find((i) => i.id === "messengers")?.badgeSource).toBe("none");
  });
});

describe("formatNavBadgeCount", () => {
  it("hides zero and formats caps", () => {
    expect(formatNavBadgeCount(0)).toBeNull();
    expect(formatNavBadgeCount(-1)).toBeNull();
    expect(formatNavBadgeCount(7)).toBe("7");
    expect(formatNavBadgeCount(99)).toBe("99");
    expect(formatNavBadgeCount(105)).toBe("99+");
  });
});

describe("NavBadge", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders nothing for zero", () => {
    const { container } = render(<NavBadge count={0} label="Входящие" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders numeric and capped badges", () => {
    const { rerender } = render(<NavBadge count={7} label="Входящие" />);
    expect(screen.getByLabelText("Входящие: 7")).toHaveTextContent("7");
    rerender(<NavBadge count={105} label="Входящие" />);
    expect(screen.getByLabelText("Входящие: 99+")).toHaveTextContent("99+");
  });

  it("hides badge when collapsed", () => {
    const { container } = render(<NavBadge count={3} label="Задачи" collapsed />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("useServiceNavBadges mail unread", () => {
  it("loads account-scoped unread and reacts to mail events", async () => {
    const threads = await import("@/services/db/threads");
    vi.mocked(threads.getUnreadInboxCountsByAccount).mockImplementation(async () => ({ "acc-1": 7 }));

    const { renderHook, act } = await import("@testing-library/react");
    const { useServiceNavBadges, MAIL_UNREAD_CHANGED_EVENT } = await import("./useServiceNavBadges");

    const { result } = renderHook(() => useServiceNavBadges("acc-1"));
    await waitFor(() => expect(result.current.mailInboxUnread).toBe(7));
    expect(result.current.getBadgeCount("mailInboxUnread")).toBe(7);
    expect(formatNavBadgeCount(result.current.mailInboxUnread)).toBe("7");

    vi.mocked(threads.getUnreadInboxCountsByAccount).mockResolvedValue({ "acc-1": 105 });
    await act(async () => {
      window.dispatchEvent(new CustomEvent(MAIL_UNREAD_CHANGED_EVENT));
    });
    await waitFor(() => expect(result.current.mailInboxUnread).toBe(105));
    expect(formatNavBadgeCount(result.current.mailInboxUnread)).toBe("99+");

    vi.mocked(threads.getUnreadInboxCountsByAccount).mockResolvedValue({ "acc-1": 0 });
    await act(async () => {
      window.dispatchEvent(new CustomEvent(MAIL_UNREAD_CHANGED_EVENT));
    });
    await waitFor(() => expect(result.current.mailInboxUnread).toBe(0));
    expect(formatNavBadgeCount(result.current.mailInboxUnread)).toBeNull();
  });
});
