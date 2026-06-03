import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the router module before importing navigate functions
const mockNavigate = vi.fn();
const mockState = {
  location: { pathname: "/mail/inbox", search: {} },
  matches: [] as Array<{ routeId: string; params: Record<string, string> }>,
};

vi.mock("./index", () => ({
  router: {
    navigate: (...args: unknown[]) => mockNavigate(...args),
    get state() {
      return mockState;
    },
  },
}));

const mockSetMessengersPanelsOpen = vi.fn();
let mockMessengersPanelsOpen = false;
vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      messengersPanelsOpen: mockMessengersPanelsOpen,
      setMessengersPanelsOpen: mockSetMessengersPanelsOpen,
    }),
  },
}));

import {
  navigateToLabel,
  navigateToThread,
  navigateToSettings,
  navigateBackFromSettings,
  navigateToRepairCenter,
  navigateBackFromRepair,
  navigateToQueueInspector,
  navigateBackFromQueueInspector,
  navigateBack,
  getActiveLabel,
  getSelectedThreadId,
} from "./navigate";

describe("navigate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetMessengersPanelsOpen.mockClear();
    mockMessengersPanelsOpen = false;
    mockState.location = { pathname: "/mail/inbox", search: {} };
    mockState.matches = [];
  });

  describe("navigateToLabel", () => {
    it("should navigate to system labels via /mail/$label", () => {
      navigateToLabel("inbox");
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/mail/$label",
        params: { label: "inbox" },
        search: {},
      });
    });

    it("should open messenger panels on mail shell without extra navigation", () => {
      mockState.location.pathname = "/mail/starred";
      navigateToLabel("messengers");
      expect(mockSetMessengersPanelsOpen).toHaveBeenCalledWith(true);
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("should open messenger panels and go to inbox when outside mail shell", () => {
      mockState.location.pathname = "/calendar";
      navigateToLabel("messengers");
      expect(mockSetMessengersPanelsOpen).toHaveBeenCalledWith(true);
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/mail/$label",
        params: { label: "inbox" },
      });
    });

    it("should navigate to starred", () => {
      navigateToLabel("starred");
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/mail/$label",
        params: { label: "starred" },
        search: {},
      });
    });

    it("should navigate to settings", () => {
      navigateToLabel("settings");
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/settings/$tab",
        params: { tab: "general" },
      });
    });

    it("should navigate to calendar", () => {
      navigateToLabel("calendar");
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/calendar" });
    });

    it("should navigate to smart folders", () => {
      navigateToLabel("smart-folder:folder-1");
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/smart-folder/$folderId",
        params: { folderId: "folder-1" },
      });
    });

    it("should navigate to smart folder with thread", () => {
      navigateToLabel("smart-folder:folder-1", { threadId: "t-1" });
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/smart-folder/$folderId/thread/$threadId",
        params: { folderId: "folder-1", threadId: "t-1" },
      });
    });

    it("should navigate to custom labels via /label/$labelId", () => {
      navigateToLabel("Label_123");
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/label/$labelId",
        params: { labelId: "Label_123" },
      });
    });

    it("should navigate to custom label with thread", () => {
      navigateToLabel("Label_123", { threadId: "t-1" });
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/label/$labelId/thread/$threadId",
        params: { labelId: "Label_123", threadId: "t-1" },
      });
    });

    it("should pass category as search param for system labels", () => {
      navigateToLabel("inbox", { category: "Updates" });
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/mail/$label",
        params: { label: "inbox" },
        search: { category: "Updates" },
      });
    });

    it("should navigate to system label with thread and category", () => {
      navigateToLabel("inbox", { category: "Social", threadId: "t-1" });
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/mail/$label/thread/$threadId",
        params: { label: "inbox", threadId: "t-1" },
        search: { category: "Social" },
      });
    });
  });

  describe("navigateToThread", () => {
    it("should append thread to /mail/$label route", () => {
      mockState.location.pathname = "/mail/inbox";
      navigateToThread("thread-abc");
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/mail/$label/thread/$threadId",
        params: { label: "inbox", threadId: "thread-abc" },
        search: {},
      });
    });

    it("should append thread to /label/$labelId route", () => {
      mockState.location.pathname = "/label/Label_5";
      navigateToThread("thread-abc");
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/label/$labelId/thread/$threadId",
        params: { labelId: "Label_5", threadId: "thread-abc" },
        search: {},
      });
    });

    it("should append thread to /smart-folder/$folderId route", () => {
      mockState.location.pathname = "/smart-folder/sf-1";
      navigateToThread("thread-abc");
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/smart-folder/$folderId/thread/$threadId",
        params: { folderId: "sf-1", threadId: "thread-abc" },
        search: {},
      });
    });

    it("should fallback to inbox when on unknown route", () => {
      mockState.location.pathname = "/settings/general";
      navigateToThread("thread-abc");
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/mail/$label/thread/$threadId",
        params: { label: "inbox", threadId: "thread-abc" },
      });
    });

    it("should preserve search params when navigating to thread", () => {
      mockState.location.pathname = "/mail/inbox";
      mockState.location.search = { category: "Updates" };
      navigateToThread("thread-abc");
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/mail/$label/thread/$threadId",
        params: { label: "inbox", threadId: "thread-abc" },
        search: { category: "Updates" },
      });
    });
  });

  describe("navigateToSettings", () => {
    it("should navigate to settings with default tab", () => {
      navigateToSettings();
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/settings/$tab",
        params: { tab: "general" },
      });
    });

    it("should navigate to settings with specific tab", () => {
      navigateToSettings("ai");
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/settings/$tab",
        params: { tab: "ai" },
      });
    });

    it("should not overwrite return snapshot when switching settings tabs", () => {
      mockState.location.pathname = "/mail/outbox";
      navigateToSettings();
      mockState.location.pathname = "/settings/general";
      navigateToSettings("ai");
      navigateBackFromSettings();
      expect(mockNavigate).toHaveBeenLastCalledWith({
        to: "/mail/$label",
        params: { label: "outbox" },
        search: {},
      });
    });
  });

  describe("navigateBackFromSettings", () => {
    it("should return to the route captured before opening settings", () => {
      mockState.location.pathname = "/attachments";
      navigateToSettings();
      navigateBackFromSettings();
      expect(mockNavigate).toHaveBeenLastCalledWith({ to: "/attachments" });
    });

    it("should restore messengers panel state when captured from mail shell", () => {
      mockState.location.pathname = "/mail/inbox";
      mockMessengersPanelsOpen = true;
      navigateToSettings();
      navigateBackFromSettings();
      expect(mockSetMessengersPanelsOpen).toHaveBeenCalledWith(true);
      expect(mockNavigate).toHaveBeenLastCalledWith({
        to: "/mail/$label",
        params: { label: "inbox" },
        search: {},
      });
    });

    it("should fall back to inbox when no snapshot exists", () => {
      mockState.location.pathname = "/settings/general";
      navigateBackFromSettings();
      expect(mockSetMessengersPanelsOpen).toHaveBeenCalledWith(false);
      expect(mockNavigate).toHaveBeenLastCalledWith({
        to: "/mail/$label",
        params: { label: "inbox" },
      });
    });

    it("should return from repair center to the settings tab that opened it", () => {
      mockState.location.pathname = "/mail/outbox";
      navigateToSettings("accounts");

      mockState.location.pathname = "/settings/accounts";
      navigateToRepairCenter("account-1");

      mockState.location.pathname = "/repair/account-1";
      navigateBackFromRepair();
      expect(mockNavigate).toHaveBeenLastCalledWith({
        to: "/settings/$tab",
        params: { tab: "accounts" },
        search: {},
      });

      mockState.location.pathname = "/settings/accounts";
      navigateBackFromSettings();
      expect(mockNavigate).toHaveBeenLastCalledWith({
        to: "/mail/$label",
        params: { label: "outbox" },
        search: {},
      });
    });

    it("should return from settings action inside repair back to repair", () => {
      mockState.location.pathname = "/mail/sent";
      navigateToSettings("accounts");

      mockState.location.pathname = "/settings/accounts";
      navigateToRepairCenter("account-1");

      mockState.location.pathname = "/repair/account-1";
      navigateToSettings("accounts");

      mockState.location.pathname = "/settings/accounts";
      navigateBackFromSettings();
      expect(mockNavigate).toHaveBeenLastCalledWith({
        to: "/repair/$accountId",
        params: { accountId: "account-1" },
        search: {},
      });
    });

    it("should unwind queue, repair, and settings one level at a time", () => {
      mockState.location.pathname = "/mail/starred";
      navigateToSettings("accounts");

      mockState.location.pathname = "/settings/accounts";
      navigateToRepairCenter("account-1");

      mockState.location.pathname = "/repair/account-1";
      navigateToQueueInspector();

      mockState.location.pathname = "/queue";
      navigateBackFromSettings();
      expect(mockNavigate).toHaveBeenLastCalledWith({
        to: "/repair/$accountId",
        params: { accountId: "account-1" },
        search: {},
      });

      mockState.location.pathname = "/repair/account-1";
      navigateBackFromRepair();
      expect(mockNavigate).toHaveBeenLastCalledWith({
        to: "/settings/$tab",
        params: { tab: "accounts" },
        search: {},
      });

      mockState.location.pathname = "/settings/accounts";
      navigateBackFromSettings();
      expect(mockNavigate).toHaveBeenLastCalledWith({
        to: "/mail/$label",
        params: { label: "starred" },
        search: {},
      });
    });

    it("should return from direct queue route to the route that opened it", () => {
      mockState.location.pathname = "/attachments";
      navigateToQueueInspector();

      mockState.location.pathname = "/queue";
      navigateBackFromQueueInspector();
      expect(mockNavigate).toHaveBeenLastCalledWith({ to: "/attachments" });
    });

    it("should use browser history for queue when it was opened without navigation snapshot", () => {
      const historyBack = vi.spyOn(window.history, "back").mockImplementation(() => {});
      vi.spyOn(window.history, "length", "get").mockReturnValue(2);

      mockState.location.pathname = "/queue";
      navigateBackFromQueueInspector();

      expect(historyBack).toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      historyBack.mockRestore();
    });
  });

  describe("navigateBack", () => {
    it("should go to parent /mail/$label from /mail/$label/thread/$threadId", () => {
      mockState.location.pathname = "/mail/inbox/thread/t-1";
      mockState.location.search = {};
      navigateBack();
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/mail/$label",
        params: { label: "inbox" },
        search: {},
      });
    });

    it("should go to parent /label/$labelId from thread route", () => {
      mockState.location.pathname = "/label/Label_5/thread/t-1";
      mockState.location.search = {};
      navigateBack();
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/label/$labelId",
        params: { labelId: "Label_5" },
        search: {},
      });
    });

    it("should go to parent /smart-folder/$folderId from thread route", () => {
      mockState.location.pathname = "/smart-folder/sf-1/thread/t-1";
      mockState.location.search = {};
      navigateBack();
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/smart-folder/$folderId",
        params: { folderId: "sf-1" },
        search: {},
      });
    });

    it("should go to inbox when not on a thread route", () => {
      mockState.location.pathname = "/calendar";
      navigateBack();
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/mail/$label",
        params: { label: "inbox" },
      });
    });

    it("should preserve search params when navigating back", () => {
      mockState.location.pathname = "/mail/inbox/thread/t-1";
      mockState.location.search = { category: "Social" };
      navigateBack();
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/mail/$label",
        params: { label: "inbox" },
        search: { category: "Social" },
      });
    });
  });

  describe("getActiveLabel", () => {
    it("should return label from mail route", () => {
      mockState.matches = [
        { routeId: "/mail/$label", params: { label: "starred" } },
      ];
      expect(getActiveLabel()).toBe("starred");
    });

    it("should return label from mail thread route", () => {
      mockState.matches = [
        { routeId: "/mail/$label/thread/$threadId", params: { label: "sent", threadId: "t-1" } },
      ];
      expect(getActiveLabel()).toBe("sent");
    });

    it("should return labelId from custom label route", () => {
      mockState.matches = [
        { routeId: "/label/$labelId", params: { labelId: "Label_42" } },
      ];
      expect(getActiveLabel()).toBe("Label_42");
    });

    it("should return smart-folder: prefix from smart folder route", () => {
      mockState.matches = [
        { routeId: "/smart-folder/$folderId", params: { folderId: "sf-1" } },
      ];
      expect(getActiveLabel()).toBe("smart-folder:sf-1");
    });

    it("should return 'settings' from settings route", () => {
      mockState.matches = [
        { routeId: "/settings/$tab", params: { tab: "general" } },
      ];
      expect(getActiveLabel()).toBe("settings");
    });

    it("should return 'calendar' from calendar route", () => {
      mockState.matches = [{ routeId: "/calendar", params: {} }];
      expect(getActiveLabel()).toBe("calendar");
    });

    it("should return 'inbox' as fallback", () => {
      mockState.matches = [];
      expect(getActiveLabel()).toBe("inbox");
    });
  });

  describe("getSelectedThreadId", () => {
    it("should return threadId from route params", () => {
      mockState.matches = [
        { routeId: "/mail/$label/thread/$threadId", params: { label: "inbox", threadId: "t-42" } },
      ];
      expect(getSelectedThreadId()).toBe("t-42");
    });

    it("should return null when no thread in route", () => {
      mockState.matches = [
        { routeId: "/mail/$label", params: { label: "inbox" } },
      ];
      expect(getSelectedThreadId()).toBeNull();
    });

    it("should return null when no matches", () => {
      mockState.matches = [];
      expect(getSelectedThreadId()).toBeNull();
    });
  });
});
