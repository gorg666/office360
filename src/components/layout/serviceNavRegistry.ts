import type { LucideIcon } from "lucide-react";
import {
  Inbox,
  Star,
  Clock,
  Send,
  SendHorizontal,
  FileEdit,
  Trash2,
  Ban,
  Mail,
  CheckSquare,
  Calendar,
  Paperclip,
  MessageCircle,
  HardDrive,
  Video,
  ListTodo,
  FolderSearch,
  Tag,
} from "lucide-react";

export type ServiceNavBadgeSource = "mailInboxUnread" | "outboxSend" | "tasksIncomplete" | "none";

export interface ServiceNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badgeSource: ServiceNavBadgeSource;
  /** True for mail folder-style routes vs service panels */
  kind: "mail" | "service" | "section";
}

/**
 * Canonical sidebar registry — every entry must have a Lucide icon and RU label.
 * Contacts are intentionally omitted until a dedicated service route exists.
 */
export const SERVICE_NAV_REGISTRY: readonly ServiceNavItem[] = [
  { id: "inbox", label: "Входящие", icon: Inbox, badgeSource: "mailInboxUnread", kind: "mail" },
  { id: "starred", label: "Помеченные", icon: Star, badgeSource: "none", kind: "mail" },
  { id: "snoozed", label: "Отложенные", icon: Clock, badgeSource: "none", kind: "mail" },
  { id: "outbox", label: "Исходящие", icon: SendHorizontal, badgeSource: "outboxSend", kind: "mail" },
  { id: "sent", label: "Отправленные", icon: Send, badgeSource: "none", kind: "mail" },
  { id: "drafts", label: "Черновики", icon: FileEdit, badgeSource: "none", kind: "mail" },
  { id: "trash", label: "Корзина", icon: Trash2, badgeSource: "none", kind: "mail" },
  { id: "spam", label: "Спам", icon: Ban, badgeSource: "none", kind: "mail" },
  { id: "all", label: "Вся почта", icon: Mail, badgeSource: "none", kind: "mail" },
  { id: "messengers", label: "Мессенджеры", icon: MessageCircle, badgeSource: "none", kind: "service" },
  { id: "tasks", label: "Задачи", icon: CheckSquare, badgeSource: "tasksIncomplete", kind: "service" },
  { id: "calendar", label: "Календарь", icon: Calendar, badgeSource: "none", kind: "service" },
  { id: "attachments", label: "Вложения", icon: Paperclip, badgeSource: "none", kind: "service" },
  { id: "disk", label: "Диск", icon: HardDrive, badgeSource: "none", kind: "service" },
  { id: "telemost", label: "Телемост", icon: Video, badgeSource: "none", kind: "service" },
  { id: "tracker", label: "Трекер", icon: ListTodo, badgeSource: "none", kind: "service" },
  { id: "smart-folders", label: "Умные папки", icon: FolderSearch, badgeSource: "none", kind: "section" },
  { id: "labels", label: "Метки", icon: Tag, badgeSource: "none", kind: "section" },
] as const;

export const SERVICE_NAV_ICON_SIZE = 18;

export function getServiceNavItem(id: string): ServiceNavItem | undefined {
  return SERVICE_NAV_REGISTRY.find((item) => item.id === id);
}

export function assertServiceNavIconsComplete(items: readonly ServiceNavItem[] = SERVICE_NAV_REGISTRY): void {
  for (const item of items) {
    if (!item.icon) {
      throw new Error(`Sidebar service "${item.id}" is missing an icon component`);
    }
    if (!item.label?.trim()) {
      throw new Error(`Sidebar service "${item.id}" is missing a label`);
    }
    if (!item.id?.trim()) {
      throw new Error("Sidebar service entry is missing a stable id");
    }
  }
}
