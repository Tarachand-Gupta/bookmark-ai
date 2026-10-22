"use client";
/* Hallmark · component scope · existing neutral tokens · pre-emit critique: P5 H4 E3 S5 R5 V4.
 * Responsive geometry and keyboard journeys are reserved for root browser QA. */
import type { OrganizationFolder } from "@bookmark-ai/types";
import { FolderInput, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { SidebarMenuAction, useSidebar } from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type FolderAction = "rename" | "move" | "remove";
export function FolderOptions({ folder, onAction, onNew }: { folder: OrganizationFolder; onAction: (folder: OrganizationFolder, action: FolderAction) => void; onNew?: () => void }) {
  const { isMobile } = useSidebar();
  return <DropdownMenu><DropdownMenuTrigger asChild><SidebarMenuAction type="button" showOnHover className="top-0! right-0 after:hidden size-11 md:size-8 [@media(pointer:coarse)]:size-11 [@media(hover:none)]:opacity-100" aria-label={`Folder options for ${folder.name}`}><MoreHorizontal aria-hidden /></SidebarMenuAction></DropdownMenuTrigger><DropdownMenuContent className="w-48 rounded-lg" side={isMobile ? "bottom" : "right"} align={isMobile ? "end" : "start"} collisionPadding={12}>
    {onNew && <DropdownMenuItem className="min-h-11 md:min-h-8 [@media(pointer:coarse)]:min-h-11" onSelect={onNew}><FolderPlus aria-hidden /><span>New subfolder</span></DropdownMenuItem>}
    <DropdownMenuItem className="min-h-11 md:min-h-8 [@media(pointer:coarse)]:min-h-11" onSelect={() => onAction(folder, "rename")}><Pencil aria-hidden /><span>Rename folder</span></DropdownMenuItem>
    <DropdownMenuItem className="min-h-11 md:min-h-8 [@media(pointer:coarse)]:min-h-11" onSelect={() => onAction(folder, "move")}><FolderInput aria-hidden /><span>Move folder</span></DropdownMenuItem>
    <DropdownMenuSeparator /><DropdownMenuItem className="min-h-11 md:min-h-8 [@media(pointer:coarse)]:min-h-11" variant="destructive" onSelect={() => onAction(folder, "remove")}><Trash2 aria-hidden /><span>Remove folder</span></DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>;
}

