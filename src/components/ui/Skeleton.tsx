export function ThreadCardSkeleton() {
  return (
    <div className="px-4 py-3 border-b border-hairline animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-surface-sunken shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between">
            <div className="h-3.5 bg-surface-sunken rounded w-28" />
            <div className="h-3 bg-surface-sunken rounded w-12" />
          </div>
          <div className="h-3 bg-surface-sunken rounded w-48" />
          <div className="h-3 bg-surface-sunken rounded w-64" />
        </div>
      </div>
    </div>
  );
}

export function EmailListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <ThreadCardSkeleton key={i} />
      ))}
    </>
  );
}

export function MessageSkeleton() {
  return (
    <div className="px-6 py-4 animate-pulse space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-surface-sunken" />
        <div className="space-y-1.5 flex-1">
          <div className="h-3.5 bg-surface-sunken rounded w-32" />
          <div className="h-3 bg-surface-sunken rounded w-48" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 bg-surface-sunken rounded w-full" />
        <div className="h-3 bg-surface-sunken rounded w-5/6" />
        <div className="h-3 bg-surface-sunken rounded w-4/6" />
        <div className="h-3 bg-surface-sunken rounded w-3/6" />
      </div>
    </div>
  );
}
