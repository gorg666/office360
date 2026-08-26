import { useId } from "react";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Hide the visible label but keep it as the accessible name. */
  hideLabel?: boolean;
  description?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * On/off switch for settings.
 *
 * The knob moves with a transform rather than a layout change so the animation
 * stays on the compositor, and it is suppressed under reduced motion via
 * `.t-fast` plus the global reduced-motion rule.
 */
export function Toggle({
  checked,
  onChange,
  label,
  hideLabel = false,
  description,
  disabled = false,
  className = "",
}: ToggleProps) {
  const id = useId();
  const descId = description ? `${id}-desc` : undefined;

  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        aria-describedby={descId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`focus-ring relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full t-fast
          disabled:cursor-not-allowed disabled:opacity-45
          ${checked ? "bg-brand" : "bg-surface-sunken border border-outline"}`}
      >
        <span
          aria-hidden
          className={`absolute top-1/2 left-0.5 h-3.5 w-3.5 -translate-y-1/2 rounded-full
            bg-white shadow-e1 t-fast ${checked ? "translate-x-[14px]" : "translate-x-0"}`}
          style={{ transitionProperty: "transform" }}
        />
      </button>
      {!hideLabel && (
        <label htmlFor={id} className="min-w-0 cursor-pointer select-none">
          <span className="block text-meta text-ink-primary">{label}</span>
          {description && (
            <span id={descId} className="mt-0.5 block text-caption text-ink-tertiary">
              {description}
            </span>
          )}
        </label>
      )}
    </div>
  );
}
