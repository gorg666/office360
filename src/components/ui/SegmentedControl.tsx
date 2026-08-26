import type { ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name when `label` is an icon rather than text. */
  ariaLabel?: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the whole group. */
  label: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * View switcher / mutually exclusive choice.
 *
 * Extracted because the calendar toolbar had one hand-rolled inline, and there
 * was nothing for anything else to reuse. The selected segment is a raised
 * surface over a sunken track, so the state reads as depth rather than as a
 * colour change alone.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "sm",
  className = "",
}: SegmentedControlProps<T>) {
  const pad = size === "md" ? "h-8 px-3 text-control" : "h-7 px-2.5 text-control";

  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex items-center gap-0.5 rounded-control bg-surface-sunken p-0.5 ${className}`}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            aria-label={option.ariaLabel}
            className={`inline-flex items-center justify-center rounded-[6px] font-medium
              focus-ring t-fast ${pad} ${
                selected
                  ? "bg-surface-raised text-ink-primary shadow-e1"
                  : "text-ink-tertiary hover:text-ink-primary"
              }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
