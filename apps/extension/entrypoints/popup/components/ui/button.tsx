import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/**
 * The popup's button primitives. Before this file the popup carried NINE
 * hand-rolled button class strings, all slightly different; every interactive
 * element now picks one of these variants instead.
 *
 * The design allows exactly ONE solid button per screen (`primary`), so treat a
 * second `primary` on the same view as a design bug rather than a styling choice.
 */

const BASE =
  "inline-flex items-center justify-center rounded-lg font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 " +
  "focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50";

const VARIANTS = {
  /** The single solid call-to-action: 38px, primary fill, 13px/600 label. */
  primary:
    "h-[38px] w-full gap-[7px] rounded-md bg-primary text-[13px] font-semibold text-primary-foreground hover:bg-primary/90",
  /** Quiet bordered follow-up ("View in app"). Same chrome as a tile, row layout. */
  outline:
    "min-h-10 w-full gap-1.5 border border-border bg-background px-3 py-2 text-xs text-foreground hover:bg-accent hover:text-accent-foreground",
  /** The quietest dismiss ("Done") — no chrome at all until hovered. */
  ghost:
    "min-h-10 w-full gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export function Button({ variant = "primary", className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={cn(BASE, VARIANTS[variant], className)} {...rest}>
      {children}
    </button>
  );
}

/**
 * A 24px square ghost icon button — the header's sign-out, the footer's gear, the
 * live panel's rename pencil. `tone="destructive"` keeps the sign-out control's
 * existing reddens-on-hover behavior.
 */
export function IconButton({
  tone = "default",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "default" | "destructive";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone === "destructive"
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-accent hover:text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * An inline text action that reads as a link, not a control — "Open live view",
 * the "settings" word inside the policy hint, "Save" next to the rename input.
 * Inherits its color from the surrounding text unless a caller overrides it.
 */
export function TextLink({ className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1 rounded-sm text-xs font-medium transition-colors hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
