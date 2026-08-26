import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  subtitle?: string;
  /** Primary affordance — an empty state that offers nothing to do is a dead end. */
  action?: ReactNode;
} & (
  | { icon: LucideIcon; illustration?: never }
  | { illustration: ComponentType<{ size?: number; className?: string }>; icon?: never }
);

export function EmptyState({ title, subtitle, action, ...rest }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      {"illustration" in rest && rest.illustration ? (
        <rest.illustration size={140} className="mb-5 opacity-70" />
      ) : "icon" in rest && rest.icon ? (
        (() => {
          const Icon = rest.icon;
          return <Icon size={40} strokeWidth={1.25} className="mb-4 text-ink-tertiary opacity-60" />;
        })()
      ) : null}
      <p className="text-section font-semibold text-ink-primary">{title}</p>
      {subtitle && <p className="mt-1.5 max-w-xs text-meta text-ink-tertiary">{subtitle}</p>}
      {action && <div className="mt-4 flex items-center gap-2">{action}</div>}
    </div>
  );
}
