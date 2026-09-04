"use client";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional count shown after the label; null/undefined renders nothing. */
  count?: number | null;
}

/**
 * A minimal text segmented control (Saved / Ongoing, Included AI / Own key).
 * Hand-rolled rather than a shadcn Tabs/ToggleGroup — neither is installed, and
 * the CLI that would add one appends duplicate theme tokens. Mirrors the
 * pill-track idiom of view-toggle.
 *
 * `fullWidth` stretches the track and splits it evenly between the options (a
 * form control, not a toolbar chip); `disabled` greys the whole track while a
 * selection is being persisted, so a second click can't race the first.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  fullWidth,
  disabled,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  fullWidth?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5",
        fullWidth && "flex w-full",
        disabled && "opacity-60",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed",
              fullWidth && "flex-1 justify-center",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.count != null && (
              <span className="tabular-nums text-xs text-muted-foreground">{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
