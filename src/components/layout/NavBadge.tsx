import { formatNavBadgeCount } from "./navBadgeFormat";

interface NavBadgeProps {
  count: number;
  label: string;
  collapsed?: boolean;
}

/** Shared sidebar badge — hidden at 0, capped at 99+. */
export function NavBadge({ count, label, collapsed = false }: NavBadgeProps) {
  const text = formatNavBadgeCount(count);
  if (!text || collapsed) return null;

  return (
    <span
      className="min-w-[1.25rem] shrink-0 rounded-full bg-accent/15 px-1.5 text-center text-[0.625rem] leading-normal text-accent tabular-nums"
      aria-label={`${label}: ${text}`}
    >
      {text}
    </span>
  );
}
