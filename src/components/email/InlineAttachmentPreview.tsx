import type { DbAttachment } from "@/services/db/attachments";
import { FileText, Image as ImageIcon } from "lucide-react";
import { formatFileSize, isImage, isPdf } from "@/utils/fileTypeHelpers";

/** Dedup attachments by filename+size (content-based) */
function dedup(attachments: DbAttachment[]): DbAttachment[] {
  const seen = new Set<string>();
  return attachments.filter((a) => {
    const key = `${a.filename}:${a.size}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface InlineAttachmentPreviewProps {
  accountId: string;
  messageId: string;
  attachments: DbAttachment[];
  referencedCids?: Set<string>;
  onAttachmentClick: (attachment: DbAttachment) => void;
}

export function InlineAttachmentPreview({
  attachments,
  referencedCids,
  onAttachmentClick,
}: InlineAttachmentPreviewProps) {
  // Filter to previewable non-inline attachments, dedup, exclude CID-referenced
  const previewableAttachments = dedup(attachments.filter((a) => {
    // Skip attachments whose CID is referenced in the email body
    if (a.content_id && getContentIdKeys(a.content_id).some((key) => referencedCids?.has(key))) return false;
    if (a.is_inline && !a.filename) return false;
    return isImage(a.mime_type, a.filename) || isPdf(a.mime_type, a.filename);
  }));

  if (previewableAttachments.length === 0) return null;

  const images = previewableAttachments.filter((a) => isImage(a.mime_type, a.filename));
  const pdfs = previewableAttachments.filter((a) => isPdf(a.mime_type, a.filename));

  return (
    <div className="mt-3">
      {/* Image thumbnails */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {images.map((att) => (
            <ImageThumbnail
              key={att.id}
              attachment={att}
              onClick={() => onAttachmentClick(att)}
            />
          ))}
        </div>
      )}

      {/* PDF cards */}
      {pdfs.length > 0 && (
        <div className="space-y-1">
          {pdfs.map((att) => (
            <button
              key={att.id}
              onClick={() => onAttachmentClick(att)}
              className="flex items-center gap-2 px-3 py-2 rounded-md bg-bg-tertiary/50 hover:bg-bg-hover transition-colors w-full text-left"
            >
              <FileText size={16} className="text-danger shrink-0" />
              <div className="min-w-0">
                <div className="text-xs text-text-primary truncate">
                  {att.filename ?? "Document.pdf"}
                </div>
                {att.size != null && (
                  <div className="text-[0.625rem] text-text-tertiary">
                    {formatFileSize(att.size)}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
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

function ImageThumbnail({
  attachment,
  onClick,
}: {
  attachment: DbAttachment;
  onClick: () => void;
}) {
  return (
    <div>
      <button
        onClick={onClick}
        className="w-[200px] h-[120px] rounded-md overflow-hidden border border-border-secondary hover:border-accent transition-colors bg-bg-tertiary flex flex-col items-center justify-center gap-2 px-3"
        title={attachment.filename ?? "Image"}
      >
        <ImageIcon size={22} className="text-text-tertiary" />
        <span className="text-xs text-text-primary truncate max-w-full">
          {attachment.filename ?? "Image"}
        </span>
        {attachment.size != null && (
          <span className="text-[0.625rem] text-text-tertiary">
            {formatFileSize(attachment.size)}
          </span>
        )}
      </button>
    </div>
  );
}

