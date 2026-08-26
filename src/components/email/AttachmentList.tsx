import { useState, useCallback, useRef, useEffect } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { getAttachmentsForMessage, type DbAttachment } from "@/services/db/attachments";
import { getEmailProvider } from "@/services/email/providerFactory";
import { Modal } from "@/components/ui/Modal";
import { Download, Eye, X } from "lucide-react";
import {
  formatFileSize,
  isImage,
  isPdf,
  isSafeRasterImagePreview,
  isText,
  canPreview,
} from "@/utils/fileTypeHelpers";
import { FileTypeIcon } from "@/components/ui/FileTypeIcon";
import { base64UrlToUint8Array, uint8ArrayToBase64DataUrl } from "@/utils/base64url";
import {
  attachmentPreviewCacheKey,
  getOrCreateAttachmentPreviewLoad,
} from "@/utils/attachmentPreviewCache";

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

interface AttachmentListProps {
  accountId: string;
  messageId: string;
  attachments: DbAttachment[];
  referencedCids?: Set<string>;
}

export function AttachmentList({ accountId, messageId, attachments, referencedCids }: AttachmentListProps) {
  const [preview, setPreview] = useState<DbAttachment | null>(null);

  const fileAttachments = dedup(attachments.filter((a) => {
    if (a.content_id && getContentIdKeys(a.content_id).some((key) => referencedCids?.has(key))) return false;
    if (a.is_inline && !a.filename) return false;
    return true;
  }));

  if (fileAttachments.length === 0) return null;

  return (
    <>
      <div className="mt-3 border-t border-hairline pt-3">
        <div className="mb-2 text-caption font-medium uppercase tracking-wider text-ink-tertiary">
          {fileAttachments.length} attachment{fileAttachments.length !== 1 ? "s" : ""}
        </div>
        <div className="flex flex-wrap gap-2">
          {fileAttachments.map((att) => {
            const showThumb = isSafeRasterImagePreview(att.mime_type, att.filename);
            return (
              <div
                key={att.id}
                className="surface-raised t-fast flex items-stretch gap-0 overflow-hidden rounded-control border border-separator hover:bg-surface-sunken"
              >
                <button
                  type="button"
                  onClick={() => setPreview(att)}
                  className="focus-ring-inset flex min-w-0 items-center gap-2 px-2 py-1.5 text-left text-control"
                >
                  {showThumb ? (
                    <AttachmentImageThumb
                      accountId={accountId}
                      messageId={messageId}
                      attachment={att}
                    />
                  ) : (
                    <span className="shrink-0 text-ink-tertiary">
                      <FileTypeIcon mimeType={att.mime_type} filename={att.filename} size={16} />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block max-w-[160px] truncate text-ink-primary">
                      {att.filename ?? "Unnamed"}
                    </span>
                    {att.size != null && (
                      <span className="block whitespace-nowrap text-caption text-ink-tertiary">
                        {formatFileSize(att.size)}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  title="Download"
                  className="focus-ring-inset t-fast border-l border-separator px-2 text-ink-tertiary hover:bg-surface-sunken hover:text-ink-primary"
                  onClick={() => setPreview(att)}
                >
                  <Download size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {preview && (
        <AttachmentPreview
          attachment={preview}
          accountId={accountId}
          messageId={messageId}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

function AttachmentImageThumb({
  accountId,
  messageId,
  attachment,
}: {
  accountId: string;
  messageId: string;
  attachment: DbAttachment;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!attachment.gmail_attachment_id) {
      setLoading(false);
      setFailed(true);
      return;
    }

    const key = attachmentPreviewCacheKey(accountId, messageId, attachment.id);
    setLoading(true);
    setFailed(false);

    void getOrCreateAttachmentPreviewLoad(key, async () => {
      const provider = await getEmailProvider(accountId);
      const response = await provider.fetchAttachment(
        messageId,
        attachment.gmail_attachment_id!,
      );
      const raw = String(response.data ?? "").replace(/\s/g, "");
      if (!raw) throw new Error("Empty attachment payload");
      const bytes = base64UrlToUint8Array(raw);
      if (bytes.byteLength > 4 * 1024 * 1024) {
        throw new Error("Attachment too large for inline thumbnail");
      }
      return uint8ArrayToBase64DataUrl(getEffectiveImageMimeType(attachment), bytes);
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setUrl(dataUrl);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accountId, messageId, attachment]);

  if (loading) {
    return <span className="w-10 h-10 rounded bg-bg-tertiary animate-pulse shrink-0" aria-hidden />;
  }

  if (failed || !url) {
    return (
      <span className="w-10 h-10 rounded bg-bg-tertiary flex items-center justify-center text-text-tertiary shrink-0">
        <FileTypeIcon mimeType={attachment.mime_type} filename={attachment.filename} size={18} />
      </span>
    );
  }

  return (
    <img
      src={url}
      alt=""
      className="w-10 h-10 rounded object-cover shrink-0 bg-bg-tertiary"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function AttachmentPreview({
  attachment,
  accountId,
  messageId,
  onClose,
}: {
  attachment: DbAttachment;
  accountId: string;
  messageId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bytesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const isPreviewable = canPreview(attachment.mime_type, attachment.filename);

  const fetchData = useCallback(async (): Promise<Uint8Array<ArrayBuffer>> => {
    if (bytesRef.current) return bytesRef.current;

    const provider = await getEmailProvider(accountId);
    const response = await provider.fetchAttachment(messageId, attachment.gmail_attachment_id!);
    const raw = String(response.data ?? "").replace(/\s/g, "");
    if (!raw) throw new Error("Empty attachment payload");

    const bytes = base64UrlToUint8Array(raw);
    bytesRef.current = bytes;
    return bytes;
  }, [accountId, messageId, attachment.gmail_attachment_id]);

  const handlePreviewLoad = useCallback(async () => {
    if (!attachment.gmail_attachment_id || !isPreviewable || previewUrl) return;

    setLoading(true);
    try {
      if (isSafeRasterImagePreview(attachment.mime_type, attachment.filename)) {
        const key = attachmentPreviewCacheKey(accountId, messageId, attachment.id);
        const dataUrl = await getOrCreateAttachmentPreviewLoad(key, async () => {
          const bytes = await fetchData();
          return uint8ArrayToBase64DataUrl(getEffectiveImageMimeType(attachment), bytes);
        });
        setPreviewUrl(dataUrl);
        return;
      }

      const bytes = await fetchData();
      const effectiveMime = isPdf(attachment.mime_type, attachment.filename)
        ? "application/pdf"
        : isImage(attachment.mime_type, attachment.filename)
          ? getEffectiveImageMimeType(attachment)
          : (attachment.mime_type ?? "application/octet-stream");

      if (isImage(attachment.mime_type, attachment.filename)) {
        setPreviewUrl(uint8ArrayToBase64DataUrl(effectiveMime, bytes));
        return;
      }
      if (isText(attachment.mime_type)) {
        setPreviewUrl(uint8ArrayToBase64DataUrl(effectiveMime, bytes));
        return;
      }

      const blob = new Blob([bytes], { type: effectiveMime });
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error("Failed to load preview:", err);
      setError("Failed to load preview");
    } finally {
      setLoading(false);
    }
  }, [attachment, isPreviewable, previewUrl, fetchData, accountId, messageId]);

  useEffect(() => {
    if (isPreviewable && !previewUrl && !loading && !error) {
      handlePreviewLoad();
    }
  }, [isPreviewable, previewUrl, loading, error, handlePreviewLoad]);

  const handleDownload = async () => {
    if (!attachment.gmail_attachment_id || saving) return;

    setSaving(true);
    try {
      const filePath = await save({
        defaultPath: attachment.filename ?? "attachment",
        filters: [{ name: "All Files", extensions: ["*"] }],
      });

      if (!filePath) {
        setSaving(false);
        return;
      }

      const bytes = await fetchData();
      await writeFile(filePath, bytes);
    } catch (err) {
      console.error("Failed to save attachment:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    onClose();
  };

  const header = (
    <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 text-ink-tertiary">
          <FileTypeIcon mimeType={attachment.mime_type} filename={attachment.filename} size={16} />
        </span>
        <span className="text-sm font-medium text-text-primary truncate">
          {attachment.filename ?? "Unnamed"}
        </span>
        {attachment.size != null && (
          <span className="text-xs text-text-tertiary whitespace-nowrap">
            ({formatFileSize(attachment.size)})
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-4">
        <button
          onClick={handleDownload}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-50"
        >
          <Download size={13} />
          {saving ? "Saving..." : "Download"}
        </button>
        <button
          onClick={handleClose}
          className="text-text-tertiary hover:text-text-primary p-0.5"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={true}
      onClose={handleClose}
      title={attachment.filename ?? "Attachment"}
      width="w-[800px]"
      panelClassName="max-w-[90vw] max-h-[85vh] flex flex-col"
      renderHeader={header}
    >
      <div className="flex-1 overflow-auto min-h-[200px] flex items-center justify-center p-4" data-native-context-menu>
        {loading && <p className="text-sm text-text-tertiary">Loading preview...</p>}
        {error && <p className="text-sm text-text-tertiary">{error}</p>}
        {!loading && !error && previewUrl && isImage(attachment.mime_type, attachment.filename) && (
          <img
            src={previewUrl}
            alt={attachment.filename ?? "Attachment"}
            className="max-w-full max-h-[70vh] object-contain rounded"
          />
        )}
        {!loading && !error && previewUrl && isPdf(attachment.mime_type, attachment.filename) && (
          <iframe
            src={previewUrl}
            title={attachment.filename ?? "PDF preview"}
            className="w-full h-[70vh] border-0 rounded"
          />
        )}
        {!loading && !error && previewUrl && isText(attachment.mime_type) && (
          <TextPreview url={previewUrl} />
        )}
        {!isPreviewable && !loading && (
          <div className="flex flex-col items-center gap-3 text-text-tertiary">
            <Eye size={40} strokeWidth={1} />
            <p className="text-sm">Preview not available for this file type</p>
            <p className="text-xs">{attachment.mime_type ?? "Unknown type"}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

export { getAttachmentsForMessage };

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

function getEffectiveImageMimeType(attachment: DbAttachment): string {
  if (attachment.mime_type?.startsWith("image/")) return attachment.mime_type;
  const filename = attachment.filename?.toLowerCase() ?? "";
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".gif")) return "image/gif";
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".svg")) return "image/svg+xml";
  if (filename.endsWith(".bmp")) return "image/bmp";
  return "image/jpeg";
}

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (url.startsWith("data:")) {
      const mark = ";base64,";
      const idx = url.indexOf(mark);
      if (idx === -1) {
        setText("Failed to load text");
        return;
      }
      try {
        const raw = url.slice(idx + mark.length);
        const bin = atob(raw);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        setText(new TextDecoder().decode(u8));
      } catch {
        setText("Failed to load text");
      }
      return;
    }

    fetch(url)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText("Failed to load text"));
  }, [url]);

  return (
    <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono w-full max-h-[70vh] overflow-auto bg-bg-tertiary rounded p-4">
      {text ?? "Loading..."}
    </pre>
  );
}
