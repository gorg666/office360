import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eye, ExternalLink } from "lucide-react";
import { getEmailProvider } from "@/services/email/providerFactory";
import { base64UrlToUint8Array, uint8ArrayToBase64DataUrl } from "@/utils/base64url";
import { formatFileSize, getFileIcon, canPreview, isImage } from "@/utils/fileTypeHelpers";
import type { AttachmentWithContext } from "@/services/db/attachments";

interface AttachmentGridItemProps {
  attachment: AttachmentWithContext;
  onPreview: () => void;
  onDownload: () => void;
  onJumpToEmail: () => void;
}

function formatRelativeDate(timestamp: number | null): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function AttachmentGridItem({ attachment, onPreview, onDownload, onJumpToEmail }: AttachmentGridItemProps) {
  const previewable = canPreview(attachment.mime_type, attachment.filename);
  const senderName = attachment.from_name || attachment.from_address || "Unknown";
  const isImageAttachment = isImage(attachment.mime_type, attachment.filename);

  return (
    <div className="group relative flex flex-col border border-border-primary rounded-lg hover:border-border-secondary hover:bg-bg-hover transition-colors overflow-hidden">
      <button
        onClick={previewable ? onPreview : onDownload}
        className="flex items-center justify-center h-24 bg-bg-secondary text-3xl overflow-hidden"
      >
        {isImageAttachment ? (
          <ImageThumbnail attachment={attachment} />
        ) : (
          getFileIcon(attachment.mime_type, attachment.filename)
        )}
      </button>

      <div className="px-3 py-2 flex flex-col gap-0.5 min-w-0">
        <span className="text-xs font-medium text-text-primary truncate" title={attachment.filename ?? undefined}>
          {attachment.filename ?? "Unnamed"}
        </span>
        <span className="text-[0.6875rem] text-text-tertiary truncate" title={senderName}>
          {senderName}
        </span>
        <div className="flex items-center gap-2 text-[0.6875rem] text-text-tertiary">
          {attachment.size != null && <span>{formatFileSize(attachment.size)}</span>}
          {attachment.date && <span>{formatRelativeDate(attachment.date)}</span>}
        </div>
      </div>

      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {previewable && (
          <button
            onClick={onPreview}
            className="p-1.5 rounded-md bg-bg-primary/90 border border-border-primary text-text-secondary hover:text-text-primary transition-colors"
            title="Preview"
          >
            <Eye size={13} />
          </button>
        )}
        <button
          onClick={onDownload}
          className="p-1.5 rounded-md bg-bg-primary/90 border border-border-primary text-text-secondary hover:text-text-primary transition-colors"
          title="Download"
        >
          <Download size={13} />
        </button>
        <button
          onClick={onJumpToEmail}
          className="p-1.5 rounded-md bg-bg-primary/90 border border-border-primary text-text-secondary hover:text-text-primary transition-colors"
          title="Jump to email"
        >
          <ExternalLink size={13} />
        </button>
      </div>
    </div>
  );
}

function ImageThumbnail({ attachment }: { attachment: AttachmentWithContext }) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const loadedRef = useRef(false);

  const loadThumbnail = useCallback(async () => {
    if (loadedRef.current || !attachment.gmail_attachment_id) return;
    loadedRef.current = true;

    try {
      const provider = await getEmailProvider(attachment.account_id);
      const response = await provider.fetchAttachment(
        attachment.message_id,
        attachment.gmail_attachment_id,
      );
      const raw = String(response.data ?? "").replace(/\s/g, "");
      if (!raw) throw new Error("Empty attachment payload");

      const bytes = base64UrlToUint8Array(raw);
      const mime = getEffectiveImageMimeType(attachment);
      setThumbnailUrl(uint8ArrayToBase64DataUrl(mime, bytes));
    } catch (err) {
      console.error("Failed to load attachment thumbnail:", err);
      setFailed(true);
    }
  }, [attachment]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadThumbnail();
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loadThumbnail]);

  if (thumbnailUrl && !failed) {
    return (
      <img
        src={thumbnailUrl}
        alt={attachment.filename ?? "Attachment preview"}
        className="w-full h-full object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span ref={containerRef} className="text-text-tertiary">
      {getFileIcon(attachment.mime_type, attachment.filename)}
    </span>
  );
}

function getEffectiveImageMimeType(attachment: AttachmentWithContext): string {
  if (attachment.mime_type?.startsWith("image/")) return attachment.mime_type;
  const filename = attachment.filename?.toLowerCase() ?? "";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".gif")) return "image/gif";
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".svg")) return "image/svg+xml";
  if (filename.endsWith(".bmp")) return "image/bmp";
  return "image/jpeg";
}
