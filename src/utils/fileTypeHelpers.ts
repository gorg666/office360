export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImage(mimeType: string | null, filename?: string | null): boolean {
  if (mimeType?.startsWith("image/")) return true;
  const ext = filename?.toLowerCase();
  return !!(
    ext?.endsWith(".png") ||
    ext?.endsWith(".jpg") ||
    ext?.endsWith(".jpeg") ||
    ext?.endsWith(".gif") ||
    ext?.endsWith(".webp") ||
    ext?.endsWith(".bmp") ||
    ext?.endsWith(".svg")
  );
}

/** Safe raster previews only (no SVG / arbitrary binary). */
export function isSafeRasterImagePreview(
  mimeType: string | null,
  filename?: string | null,
): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  if (
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/png" ||
    mime === "image/webp" ||
    mime === "image/gif"
  ) {
    return true;
  }
  if (mime.startsWith("image/") && (mime.includes("svg") || mime.includes("xml"))) {
    return false;
  }
  const ext = filename?.toLowerCase() ?? "";
  return (
    ext.endsWith(".jpg") ||
    ext.endsWith(".jpeg") ||
    ext.endsWith(".png") ||
    ext.endsWith(".webp") ||
    ext.endsWith(".gif")
  );
}

export function isPdf(mimeType: string | null, filename?: string | null): boolean {
  if (mimeType === "application/pdf") return true;
  // Gmail sometimes returns application/octet-stream for PDFs
  return filename?.toLowerCase().endsWith(".pdf") ?? false;
}

export function isText(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml";
}

export function canPreview(mimeType: string | null, filename: string | null): boolean {
  return isImage(mimeType, filename) || isPdf(mimeType, filename) || isText(mimeType);
}

export function isDocument(mimeType: string | null, filename?: string | null): boolean {
  if (mimeType) {
    if (mimeType.includes("msword") || mimeType.includes("wordprocessingml") || mimeType.includes("opendocument.text") || mimeType === "application/rtf") return true;
  }
  const ext = filename?.toLowerCase();
  return ext?.endsWith(".doc") || ext?.endsWith(".docx") || ext?.endsWith(".odt") || ext?.endsWith(".rtf") || false;
}

export function isSpreadsheet(mimeType: string | null, filename?: string | null): boolean {
  if (mimeType) {
    if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv") return true;
  }
  const ext = filename?.toLowerCase();
  return ext?.endsWith(".xls") || ext?.endsWith(".xlsx") || ext?.endsWith(".ods") || ext?.endsWith(".csv") || false;
}

export function isArchive(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return mimeType.includes("zip") || mimeType.includes("compressed") || mimeType.includes("archive") || mimeType.includes("tar") || mimeType === "application/gzip" || mimeType === "application/x-gzip";
}

/** Stable file-type kind for Lucide UI icons (no emoji glyphs). */
export type FileIconKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "spreadsheet"
  | "archive"
  | "generic";

export function getFileIconKind(
  mimeType: string | null,
  filename?: string | null,
): FileIconKind {
  if (isImage(mimeType, filename)) return "image";
  if (!mimeType) return "generic";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (isPdf(mimeType, filename)) return "pdf";
  if (isSpreadsheet(mimeType, filename)) return "spreadsheet";
  if (isArchive(mimeType)) return "archive";
  return "generic";
}
