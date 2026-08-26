import { useId, type ReactNode } from "react";
import { Check, Minus } from "lucide-react";

interface CheckboxProps {
  checked: boolean;
  /** Renders the mixed state (a dash) — for "select all" headers. */
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Checkbox built on a real <input type="checkbox">, visually replaced.
 *
 * The input keeps focus, keyboard and assistive-technology behaviour; the
 * adjacent span does the drawing and picks up `peer-focus-visible` so the ring
 * matches every other control in the app.
 */
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  className = "",
}: CheckboxProps) {
  const id = useId();
  let mark: ReactNode = null;
  if (indeterminate) mark = <Minus size={11} strokeWidth={3} />;
  else if (checked) mark = <Check size={11} strokeWidth={3} />;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="relative inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={label ? undefined : ariaLabel}
          aria-checked={indeterminate ? "mixed" : checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 h-4 w-4 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden
          className={`inline-flex h-4 w-4 items-center justify-center rounded-[5px] border t-fast
            peer-focus-visible:outline peer-focus-visible:outline-2
            peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus-ring
            peer-disabled:opacity-45
            ${checked || indeterminate
              ? "border-brand bg-brand text-brand-contrast"
              : "border-outline bg-surface-solid"}`}
        >
          {mark}
        </span>
      </span>
      {label && (
        <label htmlFor={id} className="cursor-pointer select-none text-meta text-ink-primary">
          {label}
        </label>
      )}
    </div>
  );
}
