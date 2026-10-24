"use client";

import type { Bookmark } from "@bookmark-ai/types";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { cn } from "../lib/cn";

/** Touch gets one explicit menu; a mouse/keyboard gets unobtrusive direct actions.
 * The host owns edits and delete confirmation, so opening this menu never mutates data. */
export function BookmarkActions({
  bookmark,
  onEdit,
  onDelete,
  className,
}: {
  bookmark: Bookmark;
  onEdit?: (bookmark: Bookmark) => void;
  onDelete?: (id: string) => void;
  className?: string;
}) {
  if (!onEdit && !onDelete) return null;

  const button = "flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  const item = "flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground";

  return (
    <div data-bookmark-actions={bookmark.id} className={cn("bookmark-actions shrink-0", className)}>
      <div className="bookmark-actions-direct items-center gap-0.5 rounded-md border bg-card p-0.5 shadow-sm">
        {onEdit && (
          <button type="button" onClick={() => onEdit(bookmark)} aria-label={`Edit ${bookmark.title}`} className={button}>
            <Pencil className="size-3.5" aria-hidden />
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={() => onDelete(bookmark.id)} aria-label={`Delete ${bookmark.title}`} className={cn(button, "hover:bg-destructive/10 hover:text-destructive")}>
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      <div className="bookmark-actions-menu">
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button type="button" aria-label={`Actions for ${bookmark.title}`} title="Bookmark actions" className="flex size-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:bg-muted data-[state=open]:text-foreground">
              <Ellipsis className="size-4" aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} collisionPadding={12} aria-label={`Actions for ${bookmark.title}`} className="z-50 min-w-44 max-w-[calc(100vw-1.5rem)] rounded-lg border bg-popover p-1 text-popover-foreground shadow-md" onClick={(event) => event.stopPropagation()}>
              {onEdit && <DropdownMenu.Item className={item} onSelect={() => onEdit(bookmark)}><Pencil className="size-4" aria-hidden />Edit bookmark</DropdownMenu.Item>}
              {onDelete && <DropdownMenu.Item className={cn(item, "text-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive")} onSelect={() => onDelete(bookmark.id)}><Trash2 className="size-4" aria-hidden />Delete bookmark</DropdownMenu.Item>}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}
