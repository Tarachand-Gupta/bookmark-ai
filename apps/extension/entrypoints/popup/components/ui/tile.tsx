import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/**
 * A bento tile: a real `<button>` whose whole surface is the hit target.
 *
 * `block` is the 2-up tile (icon over label over meta, left aligned, ≥64px tall);
 * `compact` is the 4-up icon strip cell that replaces the bento while the live
 * panel is expanded (≥52px tall). Neither ever nests another interactive element
 * — the live tile's switch is an absolutely positioned SIBLING (see `BentoGrid`),
 * so the accessibility tree stays flat.
 */

const LAYOUTS = {
  block:
    "min-h-16 flex-col items-start gap-1.5 px-3 py-2.5 text-left",
  compact: "min-h-[52px] flex-col items-center justify-center gap-1 px-1 py-2 text-center",
} as const;

export interface TileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  layout?: keyof typeof LAYOUTS;
  children: ReactNode;
}

export function Tile({ layout = "block", className, children, ...rest }: TileProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-full w-full rounded-lg border border-border bg-background transition-colors",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        LAYOUTS[layout],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** The label + one-line meta stack shared by every `block` tile. */
export function TileLabel({ label, meta, metaClassName }: {
  label: string;
  meta?: ReactNode;
  metaClassName?: string;
}) {
  return (
    // `w-full` matters: the tile is `items-start`, so without it this stack
    // sizes to max-content and a long meta line overflows instead of eliding.
    <span className="flex w-full min-w-0 flex-col gap-px">
      <span className="truncate text-xs font-semibold text-foreground">{label}</span>
      {meta !== undefined && (
        <span className={cn("truncate text-[11px] text-muted-foreground", metaClassName)}>
          {meta}
        </span>
      )}
    </span>
  );
}
