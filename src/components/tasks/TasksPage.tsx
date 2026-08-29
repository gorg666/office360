import { useState } from "react";
import { OrganizationTasksView } from "./OrganizationTasksView";
import { LocalTasksView } from "./LocalTasksView";

type TasksSurface = "tracker" | "local";

/**
 * Tasks entry: Tracker/org projection lists (TASKS-005) + legacy local tasks.
 */
export function TasksPage() {
  const [surface, setSurface] = useState<TasksSurface>("tracker");

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div
        className="flex gap-1 px-4 pt-2 border-b border-border-primary bg-bg-primary/80 shrink-0"
        role="tablist"
        aria-label="Тип задач"
      >
        <button
          type="button"
          role="tab"
          aria-selected={surface === "tracker"}
          onClick={() => setSurface("tracker")}
          className={`px-3 py-1.5 text-xs rounded-t-lg ${
            surface === "tracker"
              ? "bg-bg-secondary text-text-primary font-semibold border border-b-0 border-border-primary"
              : "text-text-tertiary hover:text-text-primary"
          }`}
        >
          Tracker
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={surface === "local"}
          onClick={() => setSurface("local")}
          className={`px-3 py-1.5 text-xs rounded-t-lg ${
            surface === "local"
              ? "bg-bg-secondary text-text-primary font-semibold border border-b-0 border-border-primary"
              : "text-text-tertiary hover:text-text-primary"
          }`}
        >
          Локальные
        </button>
      </div>
      {surface === "tracker" ? <OrganizationTasksView /> : <LocalTasksView />}
    </div>
  );
}
