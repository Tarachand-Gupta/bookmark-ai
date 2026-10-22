"use client";
import type { Bookmark } from "@bookmark-ai/types";
import { FolderInput, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function BookmarkActions({ bookmark, onMove, onEdit, onDelete }: { bookmark: Bookmark; onMove?: (bookmark: Bookmark) => void; onEdit?: (bookmark: Bookmark) => void; onDelete?: (id: string) => void }) {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" className="size-11 shrink-0 md:size-8 [@media(pointer:coarse)]:size-11" aria-label={`Actions for ${bookmark.title || bookmark.domain}`}><MoreHorizontal aria-hidden /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" collisionPadding={12}>
    {onMove && <DropdownMenuItem className="min-h-11 md:min-h-8 [@media(pointer:coarse)]:min-h-11" onSelect={() => onMove(bookmark)}><FolderInput aria-hidden />Move to folder</DropdownMenuItem>}
    {onEdit && <DropdownMenuItem className="min-h-11 md:min-h-8 [@media(pointer:coarse)]:min-h-11" onSelect={() => onEdit(bookmark)}><Pencil aria-hidden />Edit details</DropdownMenuItem>}
    {onDelete && <><DropdownMenuSeparator /><DropdownMenuItem className="min-h-11 md:min-h-8 [@media(pointer:coarse)]:min-h-11" variant="destructive" onSelect={() => onDelete(bookmark.id)}><Trash2 aria-hidden />Delete bookmark</DropdownMenuItem></>}
  </DropdownMenuContent></DropdownMenu>;
}
