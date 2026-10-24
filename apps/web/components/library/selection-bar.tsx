"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, CircleDot, Download, Loader2, MoreHorizontal, Sparkles, Tags, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSidebarWidth } from "@/hooks/use-app-layout";
import { useSidebar } from "@/components/ui/sidebar";

const SIDEBAR_WIDTH_ICON = "3rem";

export interface SelectionBarProps {
  /** How many items are ticked. 0 dismisses the bar. */
  count: number;
  /** Singular/plural noun for the count ("bookmark" / "session"). */
  noun: string;
  onDelete: () => void;
  onExport: () => void;
  onClear: () => void;
  /** A bulk delete is running — the actions lock and show progress. */
  busy?: boolean;
  onOrganize?: (action: "category" | "tags") => void;
  onAsk?: () => void;
}

/**
 * The floating bar that appears once anything is selected: count, Delete, Export
 * CSV, dismiss.
 *
 * Portalled to <body>: it is `fixed`, and the library page sits inside the
 * sidebar layout whose ancestors form stacking contexts — rendered in place it
 * would end up underneath the sidebar and the sticky header.
 *
 * Centred over the CONTENT region, not the viewport: the content is inset by the
 * sidebar on the left and by the docked Ask AI chat on the right, so the bar pads
 * itself by both. Padding both edges of a `justify-center` row shifts the centre
 * by exactly half the difference, which is what keeps it over the grid whether
 * the sidebar is expanded, collapsed to the icon rail, or a mobile overlay (0),
 * and whether the chat is docked (`--chat-dock-w`) or floating/closed (0px).
 */
export function SelectionBar({
  count,
  noun,
  onDelete,
  onExport,
  onClear,
  busy,
  onOrganize,
  onAsk,
}: SelectionBarProps) {
  // The sidebar's live width — expanded, collapsed off-canvas, or a mobile sheet.
  const { state, isMobile } = useSidebar();
  const expandedWidth = useSidebarWidth();
  const sidebarWidth = isMobile
    ? "0px"
    : state === "collapsed"
      ? SIDEBAR_WIDTH_ICON
      : `${expandedWidth}px`;

  // Portals need a DOM; render nothing on the server pass.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || count === 0) return null;

  return createPortal(
    <div
      role="region"
      data-composer-blocked="true"
      data-theme-picker-selection="active"
      aria-label={`${count} ${noun}${count === 1 ? "" : "s"} selected`}
      // The sidebar animates its width over 200ms/linear — match it so the bar
      // slides with the layout instead of snapping to the new centre.
      className="pointer-events-none fixed bottom-0 left-0 right-0 z-40 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-[padding] duration-200 ease-linear"
      style={{
        paddingLeft: `calc(1rem + ${sidebarWidth})`,
        paddingRight: "calc(1rem + var(--chat-dock-w, 0px))",
      }}
    >
      <div className="pointer-events-auto flex min-w-0 max-w-full items-center gap-0.5 rounded-2xl border bg-popover p-1.5 pl-3 text-popover-foreground shadow-lg">
        <span className="min-w-0 truncate pr-2 text-xs font-medium tabular-nums sm:text-sm" aria-live="polite">{count} selected</span>
        {busy && <span role="status"><Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /><span className="sr-only">Applying changes…</span></span>}
        {onOrganize && <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" className="h-11 shrink-0 px-3" disabled={busy}>Organize<ChevronDown aria-hidden /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" sideOffset={12} collisionPadding={12} className="w-72 max-w-[calc(100vw-24px)]">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Organize {count} {noun}{count === 1 ? "" : "s"}</DropdownMenuLabel>
            {([
              ["category", "Set category…", "Choose what these bookmarks are about", CircleDot],
              ["tags", "Edit tags…", "Add or remove labels across this selection", Tags],
            ] as const).map(([action, label, description, Icon]) => <DropdownMenuItem key={action} className="min-h-14 items-start gap-3 py-2.5" onSelect={() => onOrganize(action)}>
              <Icon className="mt-0.5" aria-hidden /><span className="min-w-0"><span className="block">{label}</span><span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span></span>
            </DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="size-11 shrink-0" disabled={busy} aria-label="More selection actions" title="More selection actions"><MoreHorizontal aria-hidden /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" sideOffset={12} collisionPadding={12} className="max-w-[calc(100vw-24px)]">
            {onAsk && <DropdownMenuItem className="min-h-11" onSelect={onAsk}><Sparkles aria-hidden />Ask AI about selection</DropdownMenuItem>}
            <DropdownMenuItem className="min-h-11" onSelect={onExport}><Download aria-hidden />Export selected as CSV</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" className="min-h-11" onSelect={onDelete}><Trash2 aria-hidden />Delete selected…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" className="size-11 shrink-0" onClick={onClear} disabled={busy} aria-label="Done selecting" title="Done selecting (Esc)"><X aria-hidden /></Button>
      </div>
    </div>,
    document.body,
  );
}
