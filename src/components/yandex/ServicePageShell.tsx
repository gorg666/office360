import type { ReactNode } from "react";

export function ServicePageShell({ title, description, actions, children }: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex-1 min-w-0 overflow-hidden bg-bg-primary text-text-primary flex flex-col">
      <header className="px-6 py-4 border-b border-border-primary flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-text-tertiary mt-1">{description}</p>
        </div>
        {actions}
      </header>
      <div className="flex-1 min-h-0 overflow-auto p-6">{children}</div>
    </main>
  );
}
