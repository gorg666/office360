import { type SelectHTMLAttributes, forwardRef, useId } from "react";
import { ChevronDown } from "lucide-react";

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: string;
  size?: "sm" | "md";
  error?: string;
}

/**
 * Styled wrapper around a native <select>.
 *
 * Native on purpose: it keeps the OS picker, keyboard behaviour and screen
 * reader semantics that a hand-rolled listbox would have to re-implement. The
 * audit found 62 raw <select> elements with ad-hoc styling and no shared
 * focus treatment; this is what they migrate onto.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, size = "sm", error, className = "", id, children, ...rest },
  ref,
) {
  const fallbackId = useId();
  const selectId = id ?? (label ? label.toLowerCase().replace(/\s+/g, "-") : fallbackId);

  const sizes = {
    sm: "h-8 pl-2.5 pr-8 text-control",
    md: "h-9 pl-3 pr-9 text-copy",
  };

  return (
    <div className={className}>
      {label && (
        <label htmlFor={selectId} className="mb-1.5 block text-meta text-ink-secondary">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          className={`w-full appearance-none ${sizes[size]} rounded-control border
            bg-surface-solid text-ink-primary focus-ring t-fast
            disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-tertiary
            ${error ? "border-danger-solid" : "border-outline"}`}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          size={14}
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary"
        />
      </div>
      {error && <p className="mt-1 text-caption text-danger-text">{error}</p>}
    </div>
  );
});
