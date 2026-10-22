"use client";

// Adapted from tablecn's column visibility chooser; see docs/licenses/tablecn.md.
import type { Table } from "@tanstack/react-table";
import { RotateCcw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { BOOKMARK_TABLE_LABELS, isBookmarkTableColumn } from "@/lib/bookmark-table-preferences";

export function DataTableViewOptions<TData>({
  table,
  onReset,
}: {
  table: Table<TData>;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="[@media(pointer:coarse)]:min-h-11"
          aria-label="Configure bookmark table columns"
        >
          <Settings2 aria-hidden />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 [&_[role=menuitem]]:min-h-8 [&_[role=menuitemcheckbox]]:min-h-8 [@media(pointer:coarse)]:[&_[role=menuitem]]:min-h-11 [@media(pointer:coarse)]:[&_[role=menuitemcheckbox]]:min-h-11"
      >
        <DropdownMenuLabel>Columns on this device</DropdownMenuLabel>
        {table
          .getAllLeafColumns()
          .filter((column) => isBookmarkTableColumn(column.id))
          .map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              disabled={!column.getCanHide()}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(visible) => column.toggleVisibility(visible)}
            >
              {BOOKMARK_TABLE_LABELS[column.id as keyof typeof BOOKMARK_TABLE_LABELS]}
              {column.id === "title" ? " (always shown)" : ""}
            </DropdownMenuCheckboxItem>
          ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReset}>
          <RotateCcw aria-hidden />
          Reset table
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
