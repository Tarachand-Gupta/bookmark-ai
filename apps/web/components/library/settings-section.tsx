"use client";

import { cn } from "@/lib/utils";

/**
 * THE typography + spacing system for the Settings dialog. Every pane (AI, Data,
 * Sync, Live sessions, MCP, Account) composes these three primitives and nothing
 * else — before this, each pane hand-rolled its own heading sizes, description
 * sizes and dividers, so no two panes lined up and the dialog read as six
 * different screens.
 *
 * The scale, top to bottom (deliberately only three levels):
 *
 *  1. SECTION  — one per pane. `text-base` semibold title, `text-sm` muted
 *     description, then a fixed 20px gap before the first control.
 *  2. GROUP    — a labelled block inside a pane ("Export", "Tokens", "Devices").
 *     `text-sm` semibold title, `text-xs` muted description. `divided` draws the
 *     hairline + top padding that used to be copy-pasted as `border-t pt-5`.
 *  3. ROW      — one option: `text-sm` medium label on the left, its control on
 *     the right, `text-xs` muted description underneath, indented to the label's
 *     text edge so a stack of rows reads as a list instead of loose paragraphs.
 *
 * Descriptions get SMALLER as the level gets deeper (sm → xs → xs) which is what
 * makes the hierarchy legible; nothing here should introduce a fourth size.
 */

export interface SettingsSectionProps {
  title: string;
  /** One or two sentences on what this pane is for. */
  description?: React.ReactNode;
  /** Optional glyph beside the title — the same icon the rail uses for the pane. */
  icon?: React.ElementType;
  children?: React.ReactNode;
  className?: string;
}

export function SettingsSection({
  title,
  description,
  icon: Icon,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section className={cn("space-y-5", className)}>
      <header className="space-y-1.5">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
          {title}
        </h2>
        {description && (
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}

export interface SettingsGroupProps {
  /** Omit for an unlabelled block (just the divider + spacing). */
  title?: string;
  description?: React.ReactNode;
  /** Draw the hairline + top padding that separates this block from the one above. */
  divided?: boolean;
  /** Right-aligned control on the title line (e.g. "Forget all"). */
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function SettingsGroup({
  title,
  description,
  divided,
  action,
  children,
  className,
}: SettingsGroupProps) {
  return (
    <div className={cn("space-y-3", divided && "border-t pt-5", className)}>
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {title && <h3 className="text-sm font-semibold tracking-tight">{title}</h3>}
            {description && (
              <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export interface SettingsRowProps {
  label: React.ReactNode;
  /** Ties the label to its control — always pass it when `control` is an input. */
  htmlFor?: string;
  description?: React.ReactNode;
  /** The switch / select / button that operates this option. */
  control?: React.ReactNode;
  /** Anything the row reveals under its description (a nested field, a list). */
  children?: React.ReactNode;
  /** Dim the label when the option is inert (e.g. gated behind another switch). */
  muted?: boolean;
  className?: string;
}

export function SettingsRow({
  label,
  htmlFor,
  description,
  control,
  children,
  muted,
  className,
}: SettingsRowProps) {
  // A <label> only when it points at a control; otherwise it's plain text (a
  // label with no `for` is an accessibility lie).
  const Label = htmlFor ? "label" : "span";
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-start justify-between gap-4">
        <Label
          {...(htmlFor ? { htmlFor } : {})}
          className={cn(
            "text-sm font-medium leading-6",
            muted ? "text-muted-foreground" : undefined,
          )}
        >
          {label}
        </Label>
        {control && <div className="shrink-0 pt-0.5">{control}</div>}
      </div>
      {description && (
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {children}
    </div>
  );
}
