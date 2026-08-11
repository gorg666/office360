import { memo, useState, useRef, useEffect, useMemo, forwardRef } from "react";
import { formatFullDate } from "@/utils/date";
import { EmailRenderer } from "./EmailRenderer";
import { InlineAttachmentPreview } from "./InlineAttachmentPreview";
import { AttachmentList, getAttachmentsForMessage } from "./AttachmentList";
import { PhishingBanner } from "./PhishingBanner";
import type { DbMessage } from "@/services/db/messages";
import type { DbAttachment } from "@/services/db/attachments";
import { MailMinus } from "lucide-react";
import { AuthBadge } from "./AuthBadge";
import { AuthWarningBanner } from "./AuthWarningBanner";
import { ContactAvatar } from "@/components/ui/ContactAvatar";
import { resolveMessageSenderDisplay, type ThreadSenderContext } from "@/utils/senderDisplay";
import { scanMessageLinks } from "@/services/phishing/phishingScanner";
import { addToPhishingAllowlist } from "@/services/db/phishingAllowlist";
import type { MessageScanResult } from "@/utils/phishingDetector";

const EMPTY_CONTACT_NAMES = new Map<string, string>();

interface MessageItemProps {
  message: DbMessage;
  isLast: boolean;
  blockImages?: boolean | null;
  senderAllowlisted?: boolean;
  accountId?: string;
  threadId?: string;
  isSpam?: boolean;
  focused?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
  contactDisplayNames?: Map<string, string>;
  threadSender?: ThreadSenderContext | null;
}

export const MessageItem = memo(forwardRef<HTMLDivElement, MessageItemProps>(function MessageItem({ message, isLast, blockImages, senderAllowlisted, accountId, threadId, isSpam, focused, onContextMenu, contactDisplayNames, threadSender }, ref) {
  const [expanded, setExpanded] = useState(isLast);
  const [attachments, setAttachments] = useState<DbAttachment[]>([]);
  const [authBannerDismissed, setAuthBannerDismissed] = useState(false);
  const [phishingScanResult, setPhishingScanResult] = useState<MessageScanResult | null>(null);
  const [phishingBannerDismissed, setPhishingBannerDismissed] = useState(false);
  const attachmentsLoadedRef = useRef(false);

  const loadAttachments = async () => {
    if (attachmentsLoadedRef.current) return;
    attachmentsLoadedRef.current = true;
    try {
      const atts = await getAttachmentsForMessage(message.account_id, message.id);
      setAttachments(atts);
    } catch {
      // Non-critical — just show no attachments
    }
  };

  // Load attachments for initially-expanded (last) message on mount
  useEffect(() => {
    if (isLast) {
      loadAttachments();
    }
  }, [isLast]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-expand when focused via keyboard navigation
  useEffect(() => {
    if (focused && !expanded) {
      setExpanded(true);
      loadAttachments();
    }
  }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!expanded || !message.body_html) {
      setPhishingScanResult(null);
      return;
    }

    let cancelled = false;
    scanMessageLinks(message.account_id, message.id, message.body_html, message.from_address)
      .then((result) => {
        if (!cancelled) {
          setPhishingScanResult(result);
          setPhishingBannerDismissed(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("Failed to scan message links:", err);
          setPhishingScanResult(null);
        }
      });

    return () => { cancelled = true; };
  }, [expanded, message.account_id, message.body_html, message.from_address, message.id]);

  const handleToggle = () => {
    const willExpand = !expanded;
    setExpanded(willExpand);
    if (willExpand) {
      loadAttachments();
    }
  };

  // Scan HTML body for cid: references — these images are already rendered inline
  const referencedCids = useMemo(() => {
    const cids = new Set<string>();
    if (!message.body_html) return cids;
    const regex = /\bcid:([^"'\s)]+)/gi;
    let m;
    while ((m = regex.exec(message.body_html)) !== null) {
      for (const key of getContentIdKeys(m[1])) {
        cids.add(key);
      }
    }
    return cids;
  }, [message.body_html]);

  const names = contactDisplayNames ?? EMPTY_CONTACT_NAMES;
  const fromDisplay = resolveMessageSenderDisplay(
    message.from_name,
    message.from_address,
    names,
    threadSender,
  );
  const hasRenderableBody = Boolean((message.body_html ?? message.body_text ?? "").trim());

  const handleTrustPhishingSender = async () => {
    if (!message.from_address) {
      setPhishingBannerDismissed(true);
      return;
    }
    try {
      await addToPhishingAllowlist(message.account_id, message.from_address);
    } catch (err) {
      console.warn("Failed to trust phishing sender:", err);
    } finally {
      setPhishingBannerDismissed(true);
      setPhishingScanResult(null);
    }
  };

  return (
    <div
      ref={ref}
      data-office360-context-menu-source
      className={`border-b border-border-secondary last:border-b-0 ${isSpam ? "bg-red-500/8 dark:bg-red-500/10" : ""} ${focused ? "ring-2 ring-inset ring-accent/50" : ""}`}
      onContextMenu={onContextMenu}
    >
      {/* Header — always visible, click to expand/collapse */}
      <button
        onClick={handleToggle}
        className="w-full text-left px-4 py-3 hover:bg-bg-hover transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <ContactAvatar
              email={message.from_address}
              name={fromDisplay === "Unknown" ? null : fromDisplay}
              className="w-7 h-7 rounded-full shrink-0"
              textClassName="text-xs"
              lookupExternalAvatar
            />
            <div className="min-w-0">
              <span className="text-sm font-medium text-text-primary truncate flex items-center gap-1">
                {fromDisplay}
                <AuthBadge authResults={message.auth_results} />
              </span>
              {!expanded && (
                <span className="text-xs text-text-tertiary truncate block">
                  {message.snippet}
                </span>
              )}
            </div>
          </div>
          <span className="text-xs text-text-tertiary whitespace-nowrap shrink-0 ml-2">
            {formatFullDate(message.date)}
          </span>
        </div>
        {expanded && (
          <div className="mt-1 text-xs text-text-tertiary">
            {message.to_addresses && (
              <span>To: {message.to_addresses}</span>
            )}
          </div>
        )}
      </button>

      {/* Body — shown when expanded and image setting resolved */}
      {expanded && (
        <div className="px-4 pb-4">
          {!authBannerDismissed && (
            <AuthWarningBanner
              authResults={message.auth_results}
              accountId={message.account_id}
              messageId={message.id}
              senderAddress={message.from_address}
              onDismiss={() => setAuthBannerDismissed(true)}
            />
          )}

          {!phishingBannerDismissed && phishingScanResult?.showBanner && (
            <PhishingBanner
              accountId={message.account_id}
              messageId={message.id}
              scanResult={phishingScanResult}
              onTrustSender={handleTrustPhishingSender}
            />
          )}

          {message.list_unsubscribe && (
            <UnsubscribeLink
              header={message.list_unsubscribe}
              postHeader={message.list_unsubscribe_post}
              accountId={accountId ?? message.account_id}
              threadId={threadId ?? message.thread_id}
              fromAddress={message.from_address}
              fromName={message.from_name}
            />
          )}

          {!hasRenderableBody && message.imap_uid != null ? (
            <div className="py-4 text-sm text-text-tertiary">
              Загружаю тело письма...
            </div>
          ) : blockImages != null ? (
            <EmailRenderer
              html={message.body_html}
              text={message.body_text}
              blockImages={blockImages}
              senderAddress={message.from_address}
              accountId={message.account_id}
              senderAllowlisted={senderAllowlisted}
              isSpam={!!isSpam}
              messageId={message.id}
              inlineAttachments={attachments.filter((a) =>
                a.content_id && getContentIdKeys(a.content_id).some((key) => referencedCids.has(key))
              )}
              linkScanResult={phishingScanResult}
            />
          ) : (
            <div className="py-8 text-center text-text-tertiary text-sm">Loading...</div>
          )}

          <InlineAttachmentPreview
            accountId={message.account_id}
            messageId={message.id}
            attachments={attachments}
            referencedCids={referencedCids}
            onAttachmentClick={() => {}}
          />

          <AttachmentList
            accountId={message.account_id}
            messageId={message.id}
            attachments={attachments}
            referencedCids={referencedCids}
          />
        </div>
      )}
    </div>
  );
}));

export function parseUnsubscribeUrl(header: string): string | null {
  // Prefer https URL over mailto
  const httpMatch = header.match(/<(https?:\/\/[^>]+)>/);
  if (httpMatch?.[1]) return httpMatch[1];
  const mailtoMatch = header.match(/<(mailto:[^>]+)>/);
  if (mailtoMatch?.[1]) return mailtoMatch[1];
  return null;
}

function normalizeContentId(value: string | null | undefined): string | null {
  if (!value) return null;
  let normalized = value.trim().replace(/^cid:/i, "").replace(/[<>]/g, "");
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep original when it is not URL encoded.
  }
  return normalized.toLowerCase();
}

function getContentIdKeys(value: string | null | undefined): string[] {
  const normalized = normalizeContentId(value);
  if (!normalized) return [];
  const withoutDomain = normalized.split("@")[0] ?? normalized;
  return [...new Set([normalized, withoutDomain])];
}

function UnsubscribeLink({
  header,
  postHeader,
  accountId,
  threadId,
  fromAddress,
  fromName,
}: {
  header: string;
  postHeader?: string | null;
  accountId: string;
  threadId: string;
  fromAddress: string | null;
  fromName: string | null;
}) {
  const url = parseUnsubscribeUrl(header);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "failed">("idle");
  if (!url) return null;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setStatus("loading");
    try {
      const { executeUnsubscribe } = await import("@/services/unsubscribe/unsubscribeManager");
      const result = await executeUnsubscribe(
        accountId,
        threadId,
        fromAddress ?? "unknown",
        fromName,
        header,
        postHeader ?? null,
      );
      setStatus(result.success ? "done" : "failed");
    } catch (err) {
      console.error("Failed to unsubscribe:", err);
      setStatus("failed");
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={status === "loading" || status === "done"}
      className={`flex items-center gap-1 text-xs mb-2 transition-colors ${
        status === "done"
          ? "text-success"
          : status === "failed"
            ? "text-danger"
            : "text-text-tertiary hover:text-text-secondary"
      }`}
    >
      <MailMinus size={12} />
      {status === "loading" && "Unsubscribing..."}
      {status === "done" && "Unsubscribed"}
      {status === "failed" && "Unsubscribe failed — click to retry"}
      {status === "idle" && "Unsubscribe"}
    </button>
  );
}
