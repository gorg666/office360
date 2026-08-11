import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ThreadWindow from "./ThreadWindow";
import { useAccountStore } from "./stores/accountStore";
import { moveThread } from "@/services/emailActions";

const mocks = vi.hoisted(() => ({
  loadLabels: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/stores/labelStore", () => {
  const state = {
    labels: [
      {
        id: "imap-work",
        accountId: "acc-1",
        name: "Work",
        type: "user",
        colorBg: null,
        colorFg: null,
        sortOrder: 0,
        imapFolderPath: "Work/Projects",
        imapSpecialUse: null,
      },
    ],
    isLoading: false,
    loadLabels: mocks.loadLabels,
    clearLabels: vi.fn(),
    createLabel: vi.fn(),
    updateLabel: vi.fn(),
    deleteLabel: vi.fn(),
    reorderLabels: vi.fn(),
  };
  return {
    useLabelStore: Object.assign(
      vi.fn((selector: (s: typeof state) => unknown) => selector(state)),
      { getState: () => state },
    ),
  };
});

vi.mock("./components/email/ThreadView", () => ({
  ThreadView: ({ thread }: { thread: { id: string } }) => (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(new CustomEvent("velo-move-to-folder", { detail: { threadIds: [thread.id] } }));
      }}
    >
      Open move menu
    </button>
  ),
}));

vi.mock("./components/composer/Composer", () => ({
  Composer: () => <div data-testid="composer" />,
}));

vi.mock("./components/composer/SendFeedbackToast", () => ({
  SendFeedbackToast: () => <div data-testid="send-feedback-toast" />,
}));

vi.mock("./components/ui/ContextMenuPortal", () => ({
  ContextMenuPortal: () => <div data-testid="context-menu-portal" />,
}));

vi.mock("./hooks/useSuppressBrowserContextMenu", () => ({
  useSuppressBrowserContextMenu: vi.fn(),
}));

vi.mock("./services/db/migrations", () => ({
  runMigrations: vi.fn(() => Promise.resolve()),
}));

vi.mock("./services/db/accounts", () => ({
  getAllAccounts: vi.fn(() => Promise.resolve([
    {
      id: "acc-1",
      email: "imap@example.com",
      display_name: "IMAP User",
      avatar_url: null,
      is_active: 1,
      provider: "imap",
    },
  ])),
}));

vi.mock("./services/db/settings", () => ({
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/db/settings", () => ({
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock("./services/gmail/tokenManager", () => ({
  initializeClients: vi.fn(() => Promise.resolve()),
}));

vi.mock("./services/db/threads", () => ({
  getThreadById: vi.fn(() => Promise.resolve({
    id: "thread-1",
    account_id: "acc-1",
    subject: "Popup thread",
    snippet: "Preview",
    last_message_at: 1,
    message_count: 1,
    is_read: 1,
    is_starred: 0,
    is_pinned: 0,
    is_muted: 0,
    has_attachments: 0,
    from_name: "Sender",
    from_address: "sender@example.com",
  })),
  getThreadLabelIds: vi.fn(() => Promise.resolve(["INBOX"])),
}));

vi.mock("./services/db/contacts", () => ({
  getContactDisplayNameMap: vi.fn(() => Promise.resolve(new Map())),
}));

vi.mock("./utils/themeEffects", () => ({
  applyColorTheme: vi.fn(),
  applyWindowBackground: vi.fn(),
}));

vi.mock("@/services/emailActions", () => ({
  archiveThread: vi.fn(() => Promise.resolve({ success: true })),
  trashThread: vi.fn(() => Promise.resolve({ success: true })),
  spamThread: vi.fn(() => Promise.resolve({ success: true })),
  addThreadLabel: vi.fn(() => Promise.resolve({ success: true })),
  removeThreadLabel: vi.fn(() => Promise.resolve({ success: true })),
  moveThread: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock("react-transition-group", () => ({
  CSSTransition: ({ in: inProp, children, unmountOnExit, onEntered }: { in: boolean; children: React.ReactNode; unmountOnExit?: boolean; onEntered?: () => void }) => {
    if (!inProp && unmountOnExit) return null;
    if (inProp && onEntered) {
      setTimeout(onEntered, 0);
    }
    return <>{children}</>;
  },
}));

describe("ThreadWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/thread.html?thread=thread-1&account=acc-1");
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    useAccountStore.setState({ accounts: [], activeAccountId: null });
  });

  it("loads labels for the popup account and opens Move to Folder from the popup window event", async () => {
    render(<ThreadWindow />);

    fireEvent.click(await screen.findByText("Open move menu"));

    expect(mocks.loadLabels).toHaveBeenCalledWith("acc-1");
    expect(await screen.findByPlaceholderText("Move to...")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Work"));

    await waitFor(() => {
      expect(moveThread).toHaveBeenCalledWith("acc-1", "thread-1", [], "Work/Projects");
    });
  });

  it("refreshes popup labels after sync completion", async () => {
    render(<ThreadWindow />);

    await screen.findByText("Open move menu");
    expect(mocks.loadLabels).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("velo-sync-done"));

    await waitFor(() => {
      expect(mocks.loadLabels).toHaveBeenCalledTimes(2);
    });
  });
});
