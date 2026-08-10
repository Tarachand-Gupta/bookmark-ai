"use client";

import { ChevronDown, LayoutGrid, LayoutList, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/**
 * Single dropdown-button variant of the same control: the active view's icon
 * plus a chevron, opening a menu of all three with a radio dot on the current
 * one. `ViewToggle`'s three squares plus Filters/Tags/Select is more chrome
 * than a phone-width row can fit without either wrapping or crushing the
 * labels further than requirement #2 already does — one button that always
 * reads correctly is simpler than a toggle that only works above a second,
 * unrelated threshold. Built on the same `VIEWS` table as `ViewToggle` so the
 * two can never list a different set of views or diverge on labels/icons.
 */
export function ViewMenu({
  view,
  onChange,
  className,
}: {
  view: LibraryView;
  onChange: (view: LibraryView) => void;
  className?: string;
}) {
  const current = VIEWS.find((v) => v.key === view) ?? VIEWS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          // size-9 → size-11: the icon size is a desktop/pointer size (36px);
          // this trigger is the entire view control on a touch-only surface.
          className={cn("size-11", className)}
          aria-label={`Change layout (currently ${current.label})`}
          title={current.label}
        >
          <current.Icon aria-hidden />
          <ChevronDown className="size-3" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={view} onValueChange={(next) => onChange(next as LibraryView)}>
          {VIEWS.map(({ key, label, Icon }) => (
            <DropdownMenuRadioItem key={key} value={key}>
              <Icon className="size-4" aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
