import { useRef, useCallback, useLayoutEffect, useMemo, useState, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { stripRemoteImages, hasBlockedImages } from "@/utils/imageBlocker";
import { addToAllowlist } from "@/services/db/imageAllowlist";
import { escapeHtml, sanitizeHtml } from "@/utils/sanitize";
import { useUIStore } from "@/stores/uiStore";
import type { DbAttachment } from "@/services/db/attachments";
import { normalizeBase64UrlToStandardBase64 } from "@/utils/base64url";
import type { LinkAnalysis, MessageScanResult } from "@/utils/phishingDetector";
import { LinkConfirmDialog } from "./LinkConfirmDialog";
import { SecurityWarningBanner } from "./SecurityWarningBanner";
import { createRemoteContentWarning, findLinkAnalysis, type SecurityWarningAction } from "@/services/security/securityWarnings";

interface EmailRendererProps {
  html: string | null;
  text: string | null;
  blockImages?: boolean;
  senderAddress?: string | null;
  accountId?: string | null;
  senderAllowlisted?: boolean;
  /** When true, per-sender allowlist must not bypass remote-image blocking (Spam). */
  isSpam?: boolean;
  messageId?: string | null;
  inlineAttachments?: DbAttachment[];
  linkScanResult?: MessageScanResult | null;
}

export function EmailRenderer({
  html,
  text,
  blockImages = false,
  senderAddress,
  accountId,
  senderAllowlisted = false,
  isSpam = false,
  messageId,
  inlineAttachments,
  linkScanResult,
}: EmailRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef<number>(0);
  const [overrideShow, setOverrideShow] = useState(false);
  const [cidMap, setCidMap] = useState<Map<string, string>>(new Map());
  const [pendingLink, setPendingLink] = useState<LinkAnalysis | null>(null);

  const theme = useUIStore((s) => s.theme);
  const isDark = theme === "dark"
    || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const shouldBlock =
    blockImages &&
    !overrideShow &&
    !(senderAllowlisted && !isSpam);

  // Resolve cid: references by fetching inline attachment data
  useEffect(() => {
    if (!accountId || !messageId || !inlineAttachments?.length) return;

    const cidAttachments = inlineAttachments.filter(
      (a) => a.content_id && a.gmail_attachment_id,
    );
    if (cidAttachments.length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        const { getEmailProvider } = await import("@/services/email/providerFactory");
        const provider = await getEmailProvider(accountId);
        const resolved = new Map<string, string>();

        await Promise.all(
          cidAttachments.map(async (att) => {
            try {
              const response = await provider.fetchAttachment(
                messageId,
                att.gmail_attachment_id!,
              );
              const raw = String(response.data ?? "").replace(/\s/g, "");
              if (!raw) return;
              const base64 = normalizeBase64UrlToStandardBase64(raw);
              const dataUri = `data:${getEffectiveInlineMimeType(att)};base64,${base64}`;
              for (const key of getContentIdKeys(att.content_id)) {
                resolved.set(key, dataUri);
              }
            } catch {
              // Skip individual failures
            }
          }),
        );

        if (!cancelled && resolved.size > 0) {
          setCidMap(resolved);
        }
      } catch {
        // Non-critical — images just won't render
      }
    })();

    return () => { cancelled = true; };
  }, [accountId, messageId, inlineAttachments]);

  // Sanitize once — reused by both content and blocked-image check
  const sanitizedBody = useMemo(() => {
    if (!html) return null;
    return sanitizeHtml(html);
  }, [html]);

  const isPlainText = !sanitizedBody;

  const bodyHtml = useMemo(() => {
    let body = sanitizedBody
      ?? `<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(text ?? "")}</pre>`;

    if (shouldBlock && sanitizedBody) {
      body = stripRemoteImages(body);
    }

    // Replace cid: references with resolved data URIs
    if (cidMap.size > 0) {
      body = body.replace(
        /\bcid:([^"'\s)]+)/gi,
        (match, cidRef: string) => {
          const keys = getContentIdKeys(cidRef);
          for (const key of keys) {
            const resolved = cidMap.get(key);
            if (resolved) return resolved;
          }
          return match;
        },
      );
    }

    // Hide images whose cid: was not resolved (quoted, single-quoted, or unquoted src).
    body = body.replace(
      /(<img\b[^>]*?)(\ssrc\s*=\s*)(?:"cid:[^"]*"|'cid:[^']*'|cid:[^\s>)]+)/gi,
      "$1 data-unresolved-cid=\"true\"",
    );

    return body;
  }, [sanitizedBody, text, shouldBlock, cidMap]);

  const blocked = useMemo(() => {
    if (!shouldBlock || !sanitizedBody) return false;
    return hasBlockedImages(stripRemoteImages(sanitizedBody));
  }, [shouldBlock, sanitizedBody]);

  // Write content directly into iframe document — synchronous, no srcDoc async parsing
  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    observerRef.current?.disconnect();

    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    // Plain text: blend with app theme (dark text on light bg, light text on dark bg)
    // HTML emails: always render on a light background since senders design for white/light
    const plainTextDark = isDark && isPlainText;
    const htmlDark = isDark && !isPlainText;
    doc.write(`<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      margin: 0;
      padding: 16px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: ${plainTextDark ? "#e5e7eb" : "#1f2937"};
      background: ${htmlDark ? "#f8f9fa" : "transparent"};
      word-wrap: break-word;
      overflow-wrap: break-word;
      overflow: hidden;
    }
    img { max-width: 100%; height: auto; }
    img[data-blocked-src], img[data-unresolved-cid] { display: none !important; }
    a { color: ${plainTextDark ? "#60a5fa" : "#3b82f6"}; }
    blockquote {
      border-left: 3px solid ${plainTextDark ? "#4b5563" : "#d1d5db"};
      margin: 8px 0;
      padding: 4px 12px;
      color: ${plainTextDark ? "#9ca3af" : "#6b7280"};
    }
    pre { overflow-x: auto; }
    table { max-width: 100%; }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`);
    doc.close();

    // Calculate and set height synchronously before paint
    const applyHeight = () => {
      if (!doc.body) return;
      const h = doc.body.scrollHeight;
      if (h > 0) {
        iframe.style.height = h + "px";
      }
    };
    applyHeight();

    // Watch for dynamic changes (images loading, etc.) — batched with rAF
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(applyHeight);
    });
    resizeObserver.observe(doc.body);
    observerRef.current = resizeObserver;

    // Open links in external browser via Tauri opener
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (anchor?.href) {
        e.preventDefault();
        const analysis = findLinkAnalysis(linkScanResult, anchor.href, anchor.textContent ?? "");
        if (analysis) {
          setPendingLink(analysis);
          return;
        }
        openUrl(anchor.href).catch((err) => {
          console.error("Failed to open link:", err);
        });
      }
    };
    doc.addEventListener("click", handleClick);

    return () => {
      doc.removeEventListener("click", handleClick);
      observerRef.current?.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [bodyHtml, isDark, isPlainText, linkScanResult]);

  const handleLoadImages = useCallback(() => {
    setOverrideShow(true);
  }, []);

  const handleAlwaysLoad = useCallback(async () => {
    if (accountId && senderAddress) {
      await addToAllowlist(accountId, senderAddress);
    }
    setOverrideShow(true);
  }, [accountId, senderAddress]);

  const remoteContentWarning = useMemo(() => {
    if (!blocked) return null;
    return createRemoteContentWarning({
      accountId: accountId ?? "unknown",
      messageId: messageId ?? "message",
      senderAddress,
      isSpam,
    });
  }, [accountId, blocked, isSpam, messageId, senderAddress]);

  const handleRemoteWarningAction = useCallback((action: SecurityWarningAction) => {
    if (action === "allow_once") {
      handleLoadImages();
      return;
    }
    if (action === "always_allow_sender") {
      void handleAlwaysLoad();
    }
  }, [handleAlwaysLoad, handleLoadImages]);

  const handleConfirmLink = useCallback(() => {
    if (!pendingLink) return;
    const url = pendingLink.url;
    setPendingLink(null);
    openUrl(url).catch((err) => {
      console.error("Failed to open link:", err);
    });
  }, [pendingLink]);

  return (
    <div>
      {remoteContentWarning && (
        <SecurityWarningBanner
          warning={remoteContentWarning}
          onAction={handleRemoteWarningAction}
          className="mb-2"
        />
      )}
      <iframe
        ref={iframeRef}
        sandbox="allow-same-origin"
        className={`w-full border-0 ${isDark && !isPlainText ? "rounded-md" : ""}`}
        style={{ overflow: "hidden" }}
        title="Email content"
      />
      {pendingLink && (
        <LinkConfirmDialog
          linkAnalysis={pendingLink}
          onCancel={() => setPendingLink(null)}
          onConfirm={handleConfirmLink}
        />
      )}
    </div>
  );
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

function getEffectiveInlineMimeType(attachment: DbAttachment): string {
  if (attachment.mime_type?.startsWith("image/")) return attachment.mime_type;
  const filename = attachment.filename?.toLowerCase() ?? "";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".gif")) return "image/gif";
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".svg")) return "image/svg+xml";
  if (filename.endsWith(".bmp")) return "image/bmp";
  return "image/jpeg";
}
