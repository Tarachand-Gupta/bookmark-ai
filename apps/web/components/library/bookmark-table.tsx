"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Bookmark } from "@bookmark-ai/types";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Globe } from "lucide-react";
import type { SelectionState } from "@/hooks/use-selection";
import { useBookmarkTablePreferences } from "@/hooks/use-bookmark-table-preferences";
import {
  BOOKMARK_TABLE_LABELS,
  BOOKMARK_TABLE_SIZES,
  isBookmarkTableColumn,
  loadedBookmarkSelection,
  moveBookmarkTableColumn,
  setLoadedBookmarkSelection,
} from "@/lib/bookmark-table-preferences";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableViewOptions } from "@/components/data-table/data-table-view-options";
import {
  DataTableColumnDrag,
  DataTableSortableHeader,
} from "@/components/data-table/data-table-sortable-header";
import { BookmarkActions } from "./organization/bookmark-actions";

export interface BookmarkTableProps {
  bookmarks: Bookmark[];
  selection?: SelectionState | null;
  onDelete?: (id: string) => void;
  onEdit?: (bookmark: Bookmark) => void;
  onMove?: (bookmark: Bookmark) => void;
  folderNames?: Record<string, string>;
  currentFolderId?: string;
  currentCategory?: string;
  currentCategoryId?: string;
}

function textCell(value: string) {
  return (
    <div className="truncate text-muted-foreground" title={value}>
      {value || "—"}
    </div>
  );
}

function BookmarkFavicon({ bookmark }: { bookmark: Bookmark }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const src = bookmark.og.favicon;
  return src && src !== failedUrl && /^https?:\/\//i.test(src) ? (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      className="size-4 rounded-sm"
      onError={() => setFailedUrl(src)}
    />
  ) : (
    <Globe aria-hidden className="size-4 text-muted-foreground" />
  );
}

/** Desktop-only integration belongs to the caller. One table renders the entire loaded array. */
export function BookmarkTable({
  bookmarks,
  selection,
  onDelete,
  onEdit,
  onMove,
  folderNames,
}: BookmarkTableProps) {
  const { preferences, update, reset } = useBookmarkTablePreferences();
  // Sorting is deliberately transient: every sort menu and the visible note state its loaded-row scope.
  const [sorting, setSorting] = useState<SortingState>([]);
  const container = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailableWidth(Math.floor(entry.contentRect.width)),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const hasActions = Boolean(onDelete || onEdit || onMove);
  const columns = useMemo<ColumnDef<Bookmark>[]>(() => {
    const definitions: ColumnDef<Bookmark>[] = [
      {
        id: "selection",
        size: 52,
        minSize: 52,
        maxSize: 52,
        enableHiding: false,
        enableResizing: false,
        enableSorting: false,
      },
      {
        id: "title",
        accessorFn: (bookmark) => bookmark.title || bookmark.domain,
        enableHiding: false,
        cell: ({ row }) => {
          const bookmark = row.original;
          const title = bookmark.title || bookmark.domain || bookmark.url;
          return (
            <a
              href={/^https?:\/\//i.test(bookmark.url) ? bookmark.url : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate rounded py-2 font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              title={title}
            >
              {title}
            </a>
          );
        },
      },
      {
        id: "website",
        accessorFn: (bookmark) => bookmark.domain,
        cell: ({ row }) => textCell(row.original.domain),
      },
      {
        id: "added",
        accessorFn: (bookmark) => {
          const value = Date.parse(bookmark.source.savedAt);
          return Number.isFinite(value) ? value : undefined;
        },
        sortUndefined: "last",
        cell: ({ row }) => {
          const date = new Date(row.original.source.savedAt);
          return Number.isNaN(date.getTime()) ? (
            textCell("")
          ) : (
            <time
              dateTime={row.original.source.savedAt}
              className="text-muted-foreground"
              title={date.toLocaleString()}
            >
              {date.toDateString() === new Date().toDateString()
                ? "Today"
                : date.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
                  })}
            </time>
          );
        },
      },
      {
        id: "folder",
        accessorFn: (bookmark) =>
          bookmark.folderId ? folderNames?.[bookmark.folderId] || "Unnamed folder" : "Unfiled",
        cell: (info) => textCell(String(info.getValue() ?? "")),
      },
      {
        id: "topic",
        accessorFn: (bookmark) => bookmark.category,
        cell: (info) => textCell(String(info.getValue() ?? "")),
      },
      {
        id: "tags",
        accessorFn: (bookmark) => bookmark.tags.join(", "),
        cell: (info) => textCell(String(info.getValue() ?? "")),
      },
      {
        id: "browser",
        accessorFn: (bookmark) => bookmark.source.browser,
        cell: (info) => (
          <span className="capitalize text-muted-foreground">{String(info.getValue() ?? "—")}</span>
        ),
      },
      {
        id: "device",
        accessorFn: (bookmark) => bookmark.source.deviceName || bookmark.source.device,
        cell: (info) => textCell(String(info.getValue() ?? "")),
      },
      ...(hasActions
        ? [
            {
              id: "actions",
              size: 60,
              minSize: 60,
              maxSize: 60,
              enableHiding: false,
              enableResizing: false,
              enableSorting: false,
              cell: ({ row }: { row: { original: Bookmark } }) => (
                <BookmarkActions
                  bookmark={row.original}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  onMove={onMove}
                />
              ),
            },
          ]
        : []),
    ];
    return definitions.map((column) => {
      if (!isBookmarkTableColumn(column.id)) return column;
      const sizes = BOOKMARK_TABLE_SIZES[column.id];
      return { ...column, size: sizes.size, minSize: sizes.min, maxSize: sizes.max };
    });
  }, [folderNames, hasActions, onDelete, onEdit, onMove]);

  // Give spare desktop width to Title alone. The table scrolls horizontally rather
  // than compressing Title below its 280px minimum when optional columns are shown.
  const otherWidth =
    52 +
    (hasActions ? 60 : 0) +
    preferences.columnOrder.reduce(
      (sum, id) =>
        sum +
        (id !== "title" && preferences.columnVisibility[id] !== false
          ? preferences.columnSizing[id]
          : 0),
      0,
    );
  const sizing = {
    ...preferences.columnSizing,
    title: preferences.autoFitTitle
      ? Math.max(preferences.columnSizing.title, availableWidth - otherWidth)
      : preferences.columnSizing.title,
  };
  const rowSelection = useMemo(
    () => Object.fromEntries([...(selection?.ids ?? [])].map((id) => [id, true])),
    [selection?.ids],
  );
  const table = useReactTable({
    data: bookmarks,
    columns,
    getRowId: (bookmark) => bookmark.id,
    state: {
      columnOrder: ["selection", ...preferences.columnOrder, "actions"],
      columnVisibility: preferences.columnVisibility,
      columnSizing: sizing,
      sorting,
      rowSelection,
    },
    onColumnVisibilityChange: (next) =>
      update((previous) => ({
        ...previous,
        columnVisibility: typeof next === "function" ? next(previous.columnVisibility) : next,
      })),
    onColumnSizingChange: (next) =>
      update((previous) => {
        const columnSizing =
          typeof next === "function"
            ? next({ ...previous.columnSizing, title: sizing.title })
            : next;
        return {
          ...previous,
          columnSizing,
          autoFitTitle: columnSizing.title !== sizing.title ? false : previous.autoFitTitle,
        };
      }),
    onSortingChange: setSorting,
    columnResizeMode: "onEnd",
    enableMultiSort: false,
    enableRowSelection: Boolean(selection),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const rows = table.getRowModel().rows;
  const order = rows.map((row) => row.id);
  const visibleColumns = table
    .getVisibleLeafColumns()
    .map((column) => column.id)
    .filter(isBookmarkTableColumn);
  const moveColumn = (active: string, over: string) =>
    update((previous) => ({
      ...previous,
      columnOrder: moveBookmarkTableColumn(previous.columnOrder, active, over),
    }));

  return (
    <div ref={container} className="min-w-0 space-y-2" data-slot="bookmark-table">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {bookmarks.length} loaded · Sorting applies to loaded bookmarks only
        </p>
        <DataTableViewOptions
          table={table}
          onReset={() => {
            reset();
            setSorting([]);
          }}
        />
      </div>
      <DataTableColumnDrag columns={visibleColumns} onMove={moveColumn}>
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table
            className="table-fixed"
            style={{ width: table.getTotalSize() }}
            aria-label="Bookmarks"
          >
            <TableCaption className="sr-only">
              Loaded bookmarks. Column options provide sorting, movement and visibility. Focus a
              column divider and use arrow keys to resize.
            </TableCaption>
            <colgroup>
              {table.getVisibleLeafColumns().map((column) => (
                <col key={column.id} style={{ width: column.getSize() }} />
              ))}
            </colgroup>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => {
                    const id = header.column.id;
                    if (id === "selection")
                      return (
                        <TableHead key={id} scope="col" className="bg-muted/40 p-0 text-center">
                          {selection ? (
                            <Checkbox
                              aria-label="Select loaded bookmarks"
                              disabled={!order.length}
                              checked={loadedBookmarkSelection(order, selection.ids)}
                              onCheckedChange={(checked) =>
                                selection.set(
                                  setLoadedBookmarkSelection(
                                    order,
                                    selection.ids,
                                    checked === true,
                                  ),
                                )
                              }
                              className="relative align-middle after:absolute after:-inset-3 after:content-['']"
                            />
                          ) : (
                            <span className="sr-only">Website icon</span>
                          )}
                        </TableHead>
                      );
                    if (!isBookmarkTableColumn(id))
                      return (
                        <TableHead key={id} scope="col" className="bg-muted/40">
                          <span className="sr-only">Bookmark actions</span>
                        </TableHead>
                      );
                    const index = visibleColumns.indexOf(id);
                    return (
                      <DataTableSortableHeader
                        key={id}
                        header={header}
                        label={BOOKMARK_TABLE_LABELS[id]}
                        onResize={(size) =>
                          update((previous) => ({
                            ...previous,
                            autoFitTitle: id === "title" ? false : previous.autoFitTitle,
                            columnSizing: { ...previous.columnSizing, [id]: size },
                          }))
                        }
                      >
                        <DataTableColumnHeader
                          column={header.column}
                          label={BOOKMARK_TABLE_LABELS[id]}
                          canMoveLeft={index > 0}
                          canMoveRight={index < visibleColumns.length - 1}
                          onMove={(direction) => {
                            const neighbour = visibleColumns[index + direction];
                            if (neighbour) moveColumn(id, neighbour);
                          }}
                        />
                      </DataTableSortableHeader>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="group/row"
                  data-state={row.getIsSelected() ? "selected" : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        "overflow-hidden",
                        cell.column.id === "selection" && "p-0",
                        cell.column.id === "actions" && "p-0 text-center",
                      )}
                    >
                      {cell.column.id === "selection" ? (
                        <span className="relative flex h-12 w-[52px] items-center justify-center">
                          <span
                            className={cn(
                              "pointer-events-none flex items-center justify-center",
                              selection &&
                                (selection.active
                                  ? "opacity-0"
                                  : "group-hover/row:opacity-0 group-focus-within/row:opacity-0 [@media(hover:none)]:opacity-0"),
                            )}
                          >
                            <BookmarkFavicon bookmark={row.original} />
                          </span>
                          {selection && (
                            <span
                              className={cn(
                                "absolute inset-0 flex items-center justify-center",
                                !selection.active &&
                                  "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100",
                              )}
                            >
                              <Checkbox
                                checked={selection.has(row.id)}
                                aria-label={`Select ${row.original.title || row.original.domain}`}
                                className="relative after:absolute after:-inset-3 after:content-['']"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  selection.toggle(row.id, { shiftKey: event.shiftKey, order });
                                }}
                              />
                            </span>
                          )}
                        </span>
                      ) : (
                        flexRender(cell.column.columnDef.cell, cell.getContext())
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell
                    colSpan={table.getVisibleLeafColumns().length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No bookmarks loaded.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DataTableColumnDrag>
    </div>
  );
}
