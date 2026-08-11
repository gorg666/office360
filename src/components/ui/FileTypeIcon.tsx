import {
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Paperclip,
  type LucideIcon,
} from "lucide-react";
import { getFileIconKind, type FileIconKind } from "@/utils/fileTypeHelpers";

const KIND_ICONS: Record<FileIconKind, LucideIcon> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  spreadsheet: FileSpreadsheet,
  archive: FileArchive,
  generic: Paperclip,
};

interface FileTypeIconProps {
  mimeType: string | null;
  filename?: string | null;
  size?: number;
  className?: string;
}

/** System UI file-type glyph — Lucide only (no emoji font dependency). */
export function FileTypeIcon({
  mimeType,
  filename,
  size = 16,
  className,
}: FileTypeIconProps) {
  const Icon = KIND_ICONS[getFileIconKind(mimeType, filename)];
  return <Icon size={size} className={className} aria-hidden strokeWidth={1.75} />;
}
