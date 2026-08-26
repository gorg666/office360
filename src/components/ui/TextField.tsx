import { type InputHTMLAttributes, forwardRef, useId } from "react";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  size?: "sm" | "md";
  error?: string;
  /** Helper text shown under the field when there is no error. */
  hint?: string;
}

/**
 * Single-line text input.
 *
 * The focus treatment is a real focus ring rather than the previous
 * `focus:border-accent`, which only recoloured a 1px border and made no
 * distinction between clicking into a field and tabbing to it.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, size = "sm", error, hint, className = "", id, ...rest },
  ref,
) {
  const fallbackId = useId();
  const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, "-") : fallbackId);
  const describedById = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  const sizes = {
    sm: "h-8 px-2.5 text-control",
    md: "h-9 px-3 text-copy",
  };

  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-meta text-ink-secondary">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedById}
        className={`w-full ${sizes[size]} rounded-control border bg-surface-solid text-ink-primary
          placeholder:text-ink-tertiary focus-ring t-fast
          disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-tertiary
          ${error ? "border-danger-solid" : "border-outline"}`}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-caption text-danger-text">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-caption text-ink-tertiary">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
