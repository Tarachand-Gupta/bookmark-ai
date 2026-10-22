"use client";

// Adapted from tablecn's Radix column header; see docs/licenses/tablecn.md.
import type { Column } from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  EyeOff,
  RotateCcw,
  ChevronsUpDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface DataTableColumnHeaderProps<TData> {
  column: Column<TData, unknown>;
  label: string;
  onMove: (direction: -1 | 1) => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
}

export function DataTableColumnHeader<TData>({
  column,
  label,
  onMove,
  canMoveLeft,
  canMoveRight,
}: DataTableColumnHeaderProps<TData>) {
  const sorted = column.getIsSorted();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-h-8 min-w-0 items-center gap-1 rounded px-1 py-2 text-xs [@media(pointer:coarse)]:min-h-11 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`${label} column options`}
      >
        <span className="truncate">{label}</span>
        {sorted === "asc" ? (
          <ArrowUp aria-hidden className="size-3 shrink-0" />
        ) : sorted === "desc" ? (
          <ArrowDown aria-hidden className="size-3 shrink-0" />
        ) : (
          <ChevronsUpDown aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="[&_[role=menuitem]]:min-h-8 [@media(pointer:coarse)]:[&_[role=menuitem]]:min-h-11"
      >
        {column.getCanSort() && (
          <>
            <DropdownMenuItem onSelect={() => column.toggleSorting(false)}>
              <ArrowUp aria-hidden />
              Sort loaded bookmarks ascending
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => column.toggleSorting(true)}>
              <ArrowDown aria-hidden />
              Sort loaded bookmarks descending
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!sorted} onSelect={() => column.clearSorting()}>
              <RotateCcw aria-hidden />
              Clear sort
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={!canMoveLeft} onSelect={() => onMove(-1)}>
          <ArrowLeft aria-hidden />
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canMoveRight} onSelect={() => onMove(1)}>
          <ArrowRight aria-hidden />
          Move right
        </DropdownMenuItem>
        {column.getCanHide() && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => column.toggleVisibility(false)}>
              <EyeOff aria-hidden />
              Hide {label}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
