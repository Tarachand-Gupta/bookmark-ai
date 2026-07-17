"use client";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional count shown after the label; null/undefined renders nothing. */
  count?: number | null;
}

/**
 * A minimal text segmented control (Saved / Ongoing). Hand-rolled rather than a
 * shadcn Tabs/ToggleGroup — neither is installed, and the CLI that would add one
 * appends duplicate theme tokens. Mirrors the pill-track idiom of view-toggle.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5",
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
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
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
