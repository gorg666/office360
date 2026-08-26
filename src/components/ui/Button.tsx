import { type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconOnly?: boolean;
  /** Shows a spinner and blocks interaction without collapsing the layout. */
  loading?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * The app's one button.
 *
 * Every variant carries the full state set — hover, pressed, focus-visible,
 * disabled — because the previous version had neither a pressed state nor any
 * focus treatment at all, which is a problem in a keyboard-first product.
 * Pressed feedback comes from `.pressable`, which fires on pointer-down.
 */
export function Button({
  variant = "secondary",
  size = "sm",
  icon,
  iconOnly = false,
  loading = false,
  children,
  className = "",
  disabled,
  ref,
  ...rest
}: ButtonProps) {
  const base =
    "relative inline-flex items-center justify-center font-medium rounded-control " +
    "select-none whitespace-nowrap pressable focus-ring " +
    "disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none";

  const variants: Record<ButtonVariant, string> = {
    primary:
      "bg-brand text-brand-contrast shadow-e1 hover:bg-brand-hover active:bg-brand-pressed",
    secondary:
      "bg-surface-raised text-ink-primary border border-outline shadow-e1 " +
      "hover:bg-surface-sunken active:bg-surface-sunken",
    ghost: "text-ink-secondary hover:bg-brand-tint-1 hover:text-ink-primary",
    subtle: "bg-brand-tint-1 text-brand-text hover:bg-brand-tint-2 active:bg-brand-tint-3",
    danger: "bg-danger-solid text-white shadow-e1 hover:bg-danger-text",
  };

  const sizes: Record<ButtonSize, string> = iconOnly
    ? { xs: "h-6 w-6", sm: "h-7 w-7", md: "h-8 w-8", lg: "h-10 w-10" }
    : {
        xs: "h-6 px-2 gap-1 text-caption",
        sm: "h-7 px-2.5 gap-1.5 text-control",
        md: "h-8 px-3.5 gap-2 text-control",
        lg: "h-10 px-4 gap-2 text-copy",
      };

  const spinnerSize = size === "lg" ? 16 : size === "xs" ? 11 : 13;

  return (
    <button
      ref={ref}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Loader2 size={spinnerSize} className="animate-spin" aria-hidden />
      ) : (
        icon
      )}
      {!iconOnly && children}
    </button>
  );
}
