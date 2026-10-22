"use client";

// Horizontal, handle-only adaptation of tablecn's ui/sortable.tsx (MIT).
import type { ReactNode } from "react";
import { useId } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { Header } from "@tanstack/react-table";
import { TableHead } from "@/components/ui/table";

export function DataTableColumnDrag({
  columns,
  onMove,
  children,
}: {
  columns: string[];
  onMove: (active: string, over: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis]}
      onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id) onMove(String(active.id), String(over.id));
      }}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "To reorder a column, press Space, then Left or Right, then Space to drop. Escape cancels. Column options also offer Move left and Move right.",
        },
      }}
    >
      <SortableContext items={columns} strategy={horizontalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function DataTableSortableHeader<TData>({
  header,
  label,
  onResize,
  children,
}: {
  header: Header<TData, unknown>;
  label: string;
  onResize: (size: number) => void;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: header.column.id });
  const sorted = header.column.getIsSorted();
  const min = header.column.columnDef.minSize ?? 100;
  const max = header.column.columnDef.maxSize ?? 1200;
  const resizeDelta = header.getContext().table.getState().columnSizingInfo.deltaOffset ?? 0;
  return (
    <TableHead
      ref={setNodeRef}
      scope="col"
      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
      className="group/header relative bg-muted/40 pr-3"
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 2 : undefined,
        opacity: isDragging ? 0.75 : 1,
      }}
    >
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${label} column`}
          className="flex min-h-8 min-w-6 shrink-0 touch-none items-center justify-center rounded px-0.5 py-2 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 text-muted-foreground opacity-40 hover:bg-accent focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover/header:opacity-100"
        >
          <GripVertical aria-hidden className="size-3" />
        </button>
        {children}
      </div>
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={`Resize ${label} column`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(header.getSize())}
        aria-valuetext={`${Math.round(header.getSize())} pixels. Left and Right arrows resize; Home and End set minimum and maximum.`}
        className="absolute inset-y-0 right-0 z-10 w-2 touch-none cursor-col-resize border-r border-border/60 hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:outline-2 focus-visible:outline-ring"
        onMouseDown={header.getResizeHandler()}
        onTouchStart={header.getResizeHandler()}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 40 : 16;
          const size =
            event.key === "ArrowLeft"
              ? header.getSize() - step
              : event.key === "ArrowRight"
                ? header.getSize() + step
                : event.key === "Home"
                  ? min
                  : event.key === "End"
                    ? max
                    : null;
          if (size !== null) {
            event.preventDefault();
            event.stopPropagation();
            onResize(Math.min(max, Math.max(min, size)));
          }
        }}
      />
      {header.column.getIsResizing() && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-20 border-r-2 border-primary"
          style={{ transform: `translateX(${resizeDelta}px)` }}
        />
      )}
    </TableHead>
  );
}
