export interface TimedLayoutItem {
  id: string;
  start: number;
  end: number;
}

export interface PackedTimedLayout {
  id: string;
  column: number;
  columnCount: number;
}

/**
 * Greedy overlap packing: each event occupies the first free column among
 * currently open intervals. columnCount is the max concurrency of its cluster.
 */
export function packOverlappingEvents(items: readonly TimedLayoutItem[]): PackedTimedLayout[] {
  const ordered = [...items].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const active: { id: string; end: number; column: number }[] = [];
  const columnById = new Map<string, number>();
  const countById = new Map<string, number>();
  let currentCluster: string[] = [];
  let clusterMax = 0;

  const flushCluster = () => {
    if (currentCluster.length === 0) return;
    const count = Math.max(1, clusterMax);
    for (const id of currentCluster) countById.set(id, count);
    currentCluster = [];
    clusterMax = 0;
  };

  for (const item of ordered) {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i]!.end <= item.start) active.splice(i, 1);
    }
    if (active.length === 0 && currentCluster.length > 0) flushCluster();

    const used = new Set(active.map((entry) => entry.column));
    let column = 0;
    while (used.has(column)) column += 1;
    active.push({ id: item.id, end: item.end, column });
    columnById.set(item.id, column);
    currentCluster.push(item.id);
    clusterMax = Math.max(clusterMax, active.length);
  }
  flushCluster();

  return items.map((item) => ({
    id: item.id,
    column: columnById.get(item.id) ?? 0,
    columnCount: countById.get(item.id) ?? 1,
  }));
}
