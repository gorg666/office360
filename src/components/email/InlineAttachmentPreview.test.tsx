import { render, screen } from "@testing-library/react";
import { InlineAttachmentPreview } from "./InlineAttachmentPreview";
import type { DbAttachment } from "@/services/db/attachments";

// Mock IntersectionObserver to trigger immediately
beforeAll(() => {
  class MockIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      // Trigger immediately with isIntersecting: true
      setTimeout(() => {
        callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }, 0);
    }
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
  }
  window.IntersectionObserver = MockIntersectionObserver as never;
});

const makeAttachment = (overrides: Partial<DbAttachment> = {}): DbAttachment => ({
  id: "att-1",
  message_id: "msg-1",
  account_id: "acc-1",
  filename: "photo.png",
  mime_type: "image/png",
  size: 2048,
  gmail_attachment_id: "gmail-att-1",
  content_id: null,
  is_inline: 0,
  local_path: null,
  ...overrides,
});

describe("InlineAttachmentPreview", () => {
  const onAttachmentClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock URL.createObjectURL
    global.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    global.URL.revokeObjectURL = vi.fn();
  });

  it("renders nothing when no previewable attachments", () => {
    const { container } = render(
      <InlineAttachmentPreview
        accountId="acc-1"
        messageId="msg-1"
        attachments={[makeAttachment({ mime_type: "application/zip", filename: "archive.zip" })]}
        onAttachmentClick={onAttachmentClick}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when all attachments are true inline (no filename)", () => {
    const { container } = render(
      <InlineAttachmentPreview
        accountId="acc-1"
        messageId="msg-1"
        attachments={[makeAttachment({ is_inline: 1, filename: null })]}
        onAttachmentClick={onAttachmentClick}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when all attachments have CIDs referenced in the HTML body", () => {
    const referencedCids = new Set(["img001@example.com"]);
    const { container } = render(
      <InlineAttachmentPreview
        accountId="acc-1"
        messageId="msg-1"
        attachments={[makeAttachment({ content_id: "img001@example.com", filename: "photo.png", mime_type: "image/png" })]}
        referencedCids={referencedCids}
        onAttachmentClick={onAttachmentClick}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders image thumbnails for image attachments", () => {
    render(
      <InlineAttachmentPreview
        accountId="acc-1"
        messageId="msg-1"
        attachments={[makeAttachment()]}
        onAttachmentClick={onAttachmentClick}
      />,
    );

    // Should have an image button (thumbnail container)
    expect(screen.getByTitle("photo.png")).toBeInTheDocument();
  });

  it("renders PDF cards for PDF attachments", () => {
    render(
      <InlineAttachmentPreview
        accountId="acc-1"
        messageId="msg-1"
        attachments={[makeAttachment({
          mime_type: "application/pdf",
          filename: "report.pdf",
        })]}
        onAttachmentClick={onAttachmentClick}
      />,
    );

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("does not fetch image bytes while rendering attachment placeholders", () => {
    render(
      <InlineAttachmentPreview
        accountId="acc-1"
        messageId="msg-1"
        attachments={[makeAttachment()]}
        onAttachmentClick={onAttachmentClick}
      />,
    );

    expect(screen.getByTitle("photo.png")).toBeInTheDocument();
  });

  it("renders IMAP account attachment placeholders without network fetches", () => {
    render(
      <InlineAttachmentPreview
        accountId="imap-acc"
        messageId="imap-inbox-42"
        attachments={[makeAttachment({
          account_id: "imap-acc",
          message_id: "imap-inbox-42",
          gmail_attachment_id: "1.2",
        })]}
        onAttachmentClick={onAttachmentClick}
      />,
    );

    expect(screen.getByTitle("photo.png")).toBeInTheDocument();
  });

  it("calls onAttachmentClick when image thumbnail is clicked", () => {
    const att = makeAttachment();

    render(
      <InlineAttachmentPreview
        accountId="acc-1"
        messageId="msg-1"
        attachments={[att]}
        onAttachmentClick={onAttachmentClick}
      />,
    );

    const thumbnail = screen.getByTitle("photo.png");
    thumbnail.click();

    expect(onAttachmentClick).toHaveBeenCalledWith(att);
  });

  it("calls onAttachmentClick when PDF card is clicked", () => {
    const att = makeAttachment({
      mime_type: "application/pdf",
      filename: "report.pdf",
    });

    render(
      <InlineAttachmentPreview
        accountId="acc-1"
        messageId="msg-1"
        attachments={[att]}
        onAttachmentClick={onAttachmentClick}
      />,
    );

    screen.getByText("report.pdf").click();

    expect(onAttachmentClick).toHaveBeenCalledWith(att);
  });
});
