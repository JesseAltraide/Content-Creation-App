import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-foreground hover:opacity-90 shadow-sm shadow-accent/20 disabled:opacity-40",
  secondary:
    "bg-surface text-foreground border border-border hover:bg-background disabled:opacity-40",
  ghost: "text-muted hover:bg-black/5 hover:text-foreground disabled:opacity-40",
  danger: "bg-danger text-white hover:opacity-90 disabled:opacity-40",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(({ variant = "primary", className = "", ...props }, ref) => (
  <button
    ref={ref}
    className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
    {...props}
  />
));
Button.displayName = "Button";
