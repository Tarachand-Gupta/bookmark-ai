"use client";

import { LayoutGrid, LayoutList, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type LibraryView = "grid" | "list" | "compact";

const VIEWS: { key: LibraryView; label: string; Icon: React.ElementType }[] = [
  { key: "grid", label: "Grid view", Icon: LayoutGrid },
  { key: "list", label: "List view", Icon: LayoutList },
  { key: "compact", label: "Compact view", Icon: List },
];

/** Segmented icon control switching the library between its three layouts. */
export function ViewToggle({
  view,
  onChange,
  className,
}: {
  view: LibraryView;
  onChange: (view: LibraryView) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Layout"
      className={cn("flex shrink-0 items-center gap-0.5 rounded-lg border bg-background p-0.5", className)}
    >
      {VIEWS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          aria-pressed={view === key}
          aria-label={label}
          title={label}
          onClick={() => onChange(key)}
          className={cn(
            "flex size-7 items-center justify-center rounded-md transition-colors",
            view === key
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
