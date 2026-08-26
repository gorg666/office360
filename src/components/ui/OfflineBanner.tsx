import { useUIStore } from "@/stores/uiStore";
import { WifiOff } from "lucide-react";

const TITLEBAR_HEIGHT = "top-10"; // must track TitleBar's h-10

export function OfflineBanner() {
  const isOnline = useUIStore((s) => s.isOnline);
  const pendingOpsCount = useUIStore((s) => s.pendingOpsCount);

  if (isOnline) return null;

  return (
    <div
      role="status"
      className={`fixed ${TITLEBAR_HEIGHT} inset-x-0 z-sticky flex items-center justify-center gap-2
        border-b border-warning-border bg-warning-surface px-4 py-1.5
        text-caption font-medium text-warning-text`}
    >
      <WifiOff size={13} aria-hidden />
      <span>
        You're offline — changes will sync when you reconnect
        {pendingOpsCount > 0 ? ` (${pendingOpsCount} queued)` : ""}
      </span>
    </div>
  );
}
