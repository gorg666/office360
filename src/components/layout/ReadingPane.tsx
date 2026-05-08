import { ThreadView } from "../email/ThreadView";
import { useThreadStore } from "@/stores/threadStore";
import { useSelectedThreadId } from "@/hooks/useRouteNavigation";
import { EmptyState } from "../ui/EmptyState";
import { ReadingPaneIllustration } from "../ui/illustrations";
import { APP_NAME_EN } from "@/i18n";

type ReadingPaneProps = {
  selectedThreadId?: string | null;
  disableGlass?: boolean;
  taskExtractSignal?: number;
  renderTaskSidebar?: boolean;
};

export function ReadingPane({
  selectedThreadId: selectedThreadIdOverride,
  disableGlass = false,
  taskExtractSignal = 0,
  renderTaskSidebar = true,
}: ReadingPaneProps = {}) {
  const routeSelectedThreadId = useSelectedThreadId();
  const selectedThreadId = selectedThreadIdOverride ?? routeSelectedThreadId;
  const selectedThread = useThreadStore((s) => selectedThreadId ? s.threadMap.get(selectedThreadId) ?? null : null);
  const panelClassName = disableGlass ? "min-w-0 shadow-none" : "glass-panel";

  if (!selectedThread) {
    return (
      <div className={`flex-1 flex flex-col bg-bg-primary/50 ${panelClassName}`}>
        <EmptyState illustration={ReadingPaneIllustration} title={APP_NAME_EN} subtitle="Select an email to read" />
      </div>
    );
  }

  return (
    <div className={`flex-1 bg-bg-primary/50 overflow-hidden ${panelClassName}`}>
      <ThreadView thread={selectedThread} taskExtractSignal={taskExtractSignal} renderTaskSidebar={renderTaskSidebar} />
    </div>
  );
}
