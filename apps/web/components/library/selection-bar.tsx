"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * The sidebar's widths, mirroring SIDEBAR_WIDTH / SIDEBAR_WIDTH_ICON in
 * components/ui/sidebar.tsx. They can't be read as `var(--sidebar-width)` here:
 * that variable is declared on the SidebarProvider wrapper, and this bar is
 * portalled to <body>, outside its scope. The sidebar is `collapsible="icon"`
 * (see app-sidebar.tsx), so collapsed it is the 3rem rail; on mobile, where it's
 * an overlay sheet, it takes no width at all.
 */
const SIDEBAR_WIDTH = "16rem";
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
}: SelectionBarProps) {
  // The sidebar's live width — expanded, collapsed off-canvas, or a mobile sheet.
  const { state, isMobile } = useSidebar();
  const sidebarWidth = isMobile
    ? "0px"
    : state === "collapsed"
      ? SIDEBAR_WIDTH_ICON
      : SIDEBAR_WIDTH;

  // Portals need a DOM; render nothing on the server pass.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || count === 0) return null;

  return createPortal(
    <div
      role="region"
      aria-label={`${count} ${noun}${count === 1 ? "" : "s"} selected`}
      // The sidebar animates its width over 200ms/linear — match it so the bar
      // slides with the layout instead of snapping to the new centre.
      className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-[padding] duration-200 ease-linear"
      style={{
        paddingLeft: `calc(1rem + ${sidebarWidth})`,
        paddingRight: "calc(1rem + var(--chat-dock-w, 0px))",
      }}
    >
      <div className="pointer-events-auto flex min-w-0 max-w-full items-center gap-1 rounded-full border bg-popover/95 p-1.5 pl-4 text-popover-foreground shadow-lg backdrop-blur duration-200 animate-in fade-in slide-in-from-bottom-4">
        <span className="whitespace-nowrap text-sm font-medium tabular-nums">
          {count} selected
        </span>
        <Separator orientation="vertical" className="mx-1 !h-5" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={busy}
          className="rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
          Delete
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onExport}
          disabled={busy}
          className="rounded-full"
        >
          <Download aria-hidden />
          <span className="hidden sm:inline">Export CSV</span>
          <span className="sm:hidden">CSV</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClear}
          disabled={busy}
          aria-label="Clear selection"
          title="Clear selection (Esc)"
          className="rounded-full"
        >
          <X aria-hidden />
        </Button>
      </div>
    </div>,
    document.body,
  );
}
