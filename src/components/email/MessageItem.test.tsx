import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { MessageItem } from "./MessageItem";
import type { DbMessage } from "@/services/db/messages";

vi.mock("./EmailRenderer", () => ({
  EmailRenderer: (props: { linkScanResult?: unknown }) => (
    <div
      data-testid="email-renderer"
      data-has-link-scan={props.linkScanResult ? "true" : "false"}
    />
  ),
}));

vi.mock("./InlineAttachmentPreview", () => ({
  InlineAttachmentPreview: () => null,
}));

vi.mock("./AttachmentList", () => ({
  AttachmentList: () => null,
  getAttachmentsForMessage: vi.fn().mockResolvedValue([]),
}));

vi.mock("./AuthBadge", () => ({
  AuthBadge: () => null,
}));

vi.mock("./AuthWarningBanner", () => ({
  AuthWarningBanner: () => null,
}));

vi.mock("./PhishingBanner", () => ({
  PhishingBanner: ({ onTrustSender }: { onTrustSender: () => void }) => (
    <button data-testid="phishing-banner" onClick={onTrustSender}>Trust sender</button>
  ),
}));

vi.mock("@/components/ui/ContactAvatar", () => ({
  ContactAvatar: () => <div data-testid="contact-avatar" />,
}));

const mockScanMessageLinks = vi.fn();
const mockAddToPhishingAllowlist = vi.fn();

vi.mock("@/services/phishing/phishingScanner", () => ({
  scanMessageLinks: (...args: unknown[]) => mockScanMessageLinks(...args),
}));

vi.mock("@/services/db/phishingAllowlist", () => ({
  addToPhishingAllowlist: (...args: unknown[]) => mockAddToPhishingAllowlist(...args),
}));

function makeMessage(overrides: Partial<DbMessage> = {}): DbMessage {
  return {
    id: "m1",
    account_id: "a1",
    thread_id: "t1",
    from_address: "bob@example.com",
    from_name: "Bob",
    to_addresses: "alice@example.com",
    cc_addresses: null,
    bcc_addresses: null,
    reply_to: null,
    subject: "Test subject",
    snippet: "Test snippet",
    date: Date.now(),
    is_read: 0,
    is_starred: 0,
    body_html: "<p>Hello</p>",
    body_text: "Hello",
    body_cached: 1,
    raw_size: 100,
    internal_date: null,
    list_unsubscribe: null,
    list_unsubscribe_post: null,
    auth_results: null,
    message_id_header: null,
    references_header: null,
    in_reply_to_header: null,
    ...overrides,
  };
}

describe("MessageItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanMessageLinks.mockReturnValue(new Promise(() => {}));
    mockAddToPhishingAllowlist.mockResolvedValue(undefined);
  });

  it("renders sender name", () => {
    render(<MessageItem message={makeMessage()} isLast={true} blockImages={false} />);
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("applies red background when isSpam is true", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={true} blockImages={false} isSpam={true} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("bg-red-500/8");
  });

  it("does not apply red background when isSpam is false", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={true} blockImages={false} isSpam={false} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).not.toContain("bg-red-500");
  });

  it("does not apply red background when isSpam is undefined", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={true} blockImages={false} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).not.toContain("bg-red-500");
  });

  it("applies focus ring when focused prop is true", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={false} blockImages={false} focused={true} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("ring-accent/50");
  });

  it("does not apply focus ring when focused is false", () => {
    const { container } = render(
      <MessageItem message={makeMessage()} isLast={false} blockImages={false} focused={false} />,
    );
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).not.toContain("ring-accent/50");
  });

  it("auto-expands when focused becomes true", () => {
    // Render collapsed (isLast=false, not focused)
    const { container, rerender } = render(
      <MessageItem message={makeMessage()} isLast={false} blockImages={false} focused={false} />,
    );
    // Should be collapsed — no email renderer visible
    expect(container.querySelector("[data-testid='email-renderer']")).toBeNull();

    // Now set focused=true
    rerender(
      <MessageItem message={makeMessage()} isLast={false} blockImages={false} focused={true} />,
    );
    // Should now be expanded — email renderer visible
    expect(container.querySelector("[data-testid='email-renderer']")).toBeInTheDocument();
  });

  it("forwards ref to outer div", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <MessageItem ref={ref} message={makeMessage()} isLast={true} blockImages={false} />,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it("scans expanded HTML messages and passes result to renderer", async () => {
    mockScanMessageLinks.mockResolvedValue({
      messageId: "m1",
      links: [],
      maxRiskScore: 0,
      suspiciousLinkCount: 0,
      showBanner: false,
      scannedAt: 1,
    });

    render(<MessageItem message={makeMessage()} isLast={true} blockImages={false} />);

    await waitFor(() => {
      expect(mockScanMessageLinks).toHaveBeenCalledWith("a1", "m1", "<p>Hello</p>", "bob@example.com");
      expect(screen.getByTestId("email-renderer")).toHaveAttribute("data-has-link-scan", "true");
    });
  });

  it("shows phishing banner and can trust sender", async () => {
    mockScanMessageLinks.mockResolvedValue({
      messageId: "m1",
      links: [],
      maxRiskScore: 60,
      suspiciousLinkCount: 1,
      showBanner: true,
      scannedAt: 1,
    });

    render(<MessageItem message={makeMessage()} isLast={true} blockImages={false} />);

    const trustButton = await screen.findByTestId("phishing-banner");
    trustButton.click();

    await waitFor(() => {
      expect(mockAddToPhishingAllowlist).toHaveBeenCalledWith("a1", "bob@example.com");
    });
  });
});
