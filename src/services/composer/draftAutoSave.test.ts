import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useComposerStore } from "@/stores/composerStore";
import { startAutoSave, stopAutoSave } from "./draftAutoSave";

// Mock emailActions instead of getGmailClient
vi.mock("@/services/emailActions", () => ({
  createDraft: vi.fn().mockResolvedValue({ success: true, data: { draftId: "draft-1" } }),
  updateDraft: vi.fn().mockResolvedValue({ success: true }),
}));

import { createDraft } from "@/services/emailActions";
import { createMockAccountStoreState } from "@/test/mocks";

vi.mock("@/stores/accountStore", () => ({
  useAccountStore: {
    getState: () => createMockAccountStoreState({
      accounts: [{ id: "account-1", email: "test@example.com" }],
    }),
  },
}));

describe("draftAutoSave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useComposerStore.setState({
      isOpen: true,
      mode: "new",
      to: ["recipient@example.com"],
      cc: [],
      bcc: [],
      subject: "Test",
      bodyHtml: "<p>Hello</p>",
      threadId: null,
      inReplyToMessageId: null,
      showCcBcc: false,
      draftId: null,
      undoSendTimer: null,
      undoSendVisible: false,
      attachments: [],
      lastSavedAt: null,
      isSaving: false,
      signatureHtml: "",
      signatureId: null,
    });
  });

  afterEach(() => {
    stopAutoSave();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts and stops without error", () => {
    startAutoSave("account-1");
    stopAutoSave();
  });

  it("triggers save after debounce when body changes", async () => {
    startAutoSave("account-1");

    // Simulate a body change
    useComposerStore.getState().setBodyHtml("<p>Updated</p>");

    // Before debounce, draft should not be saved
    expect(useComposerStore.getState().draftId).toBeNull();

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(3500);

    // Draft should now be saved
    expect(useComposerStore.getState().draftId).toBe("draft-1");
    expect(useComposerStore.getState().lastSavedAt).not.toBeNull();
  });

  it("does not save when composer is closed", async () => {
    startAutoSave("account-1");

    useComposerStore.setState({ isOpen: false });
    useComposerStore.getState().setSubject("Changed");

    await vi.advanceTimersByTimeAsync(3500);

    expect(useComposerStore.getState().draftId).toBeNull();
  });

  it("includes cc, bcc, and attachments in saved draft raw MIME", async () => {
    useComposerStore.setState({
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      attachments: [
        {
          id: "att-1",
          file: new File(["hello"], "hello.txt", { type: "text/plain" }),
          filename: "hello.txt",
          mimeType: "text/plain",
          size: 5,
          content: btoa("hello"),
        },
      ],
    });
    startAutoSave("account-1");

    useComposerStore.getState().setSubject("Updated");
    await vi.advanceTimersByTimeAsync(3500);

    const raw = vi.mocked(createDraft).mock.calls[0]?.[1];
    expect(raw).toBeTruthy();
    const decoded = decodeBase64Url(raw!);
    expect(decoded).toContain("Cc: cc@example.com");
    expect(decoded).toContain("Bcc: bcc@example.com");
    expect(decoded).toContain('filename="hello.txt"');
  });
});

function decodeBase64Url(encoded: string): string {
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
