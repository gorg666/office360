import type { SidebarNavItem } from "@/stores/uiStore";

export function normalizeSidebarNavConfig(items: SidebarNavItem[]): SidebarNavItem[] {
  const result = items.filter((item) => item.id !== "outbox");
  const sentIndex = result.findIndex((item) => item.id === "sent");
  const outbox = items.find((item) => item.id === "outbox") ?? { id: "outbox", visible: true };
  result.splice(sentIndex >= 0 ? sentIndex + 1 : 0, 0, outbox);
  return result;
}
