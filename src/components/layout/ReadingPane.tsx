import { ThreadView } from "../email/ThreadView";
import { useThreadStore } from "@/stores/threadStore";
import { useSelectedThreadId } from "@/hooks/useRouteNavigation";
import { EmptyState } from "../ui/EmptyState";
import { ReadingPaneIllustration } from "../ui/illustrations";
import { APP_NAME_EN } from "@/i18n";

type ReadingPaneProps = {
  selectedThreadId?: string | null;
  /**
   * Retained for callers; the pane no longer varies on it. Reading is the one
   * thing this pane exists for, so it is always opaque — the translucency here
   * was costing contrast on running text for no benefit.
   */
  disableGlass?: boolean;
  taskExtractSignal?: number;
  renderTaskSidebar?: boolean;
};

export function ReadingPane({
  selectedThreadId: selectedThreadIdOverride,
  taskExtractSignal = 0,
  renderTaskSidebar = true,
}: ReadingPaneProps = {}) {
  const routeSelectedThreadId = useSelectedThreadId();
  const selectedThreadId = selectedThreadIdOverride ?? routeSelectedThreadId;
  const selectedThread = useThreadStore((s) => selectedThreadId ? s.threadMap.get(selectedThreadId) ?? null : null);

  if (!selectedThread) {
    return (
      <div className="surface-solid flex min-h-0 min-w-0 flex-1 flex-col">
        <EmptyState illustration={ReadingPaneIllustration} title={APP_NAME_EN} subtitle="Select an email to read" />
      </div>
    );
  }

  return (
    <div className="surface-solid min-h-0 min-w-0 flex-1 overflow-hidden">
      <ThreadView thread={selectedThread} taskExtractSignal={taskExtractSignal} renderTaskSidebar={renderTaskSidebar} />
    </div>
  );
}
