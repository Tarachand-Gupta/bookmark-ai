"use client";

import { useCallback, useEffect, useRef } from "react";
import { appLayoutStore, useAppLayout, useSidebarWidth } from "@/hooks/use-app-layout";

/** Header height (px) the docked panel sits under — keep in sync with LibraryHeader. */
const HEADER_PX = 57;

/** The CSS custom property the docked (side) panel publishes on <html> so pages
 * can reserve right-side space and stay squeezed beside it (like Cloudflare's
 * assistant). 0px in overlay/full/closed states, where the panel floats over
 * content instead. Consumed by the pages' content shells and the selection bar. */
const DOCK_WIDTH_VAR = "--chat-dock-w";

/**
 * Responsive shell for the AI chat, mounted ONCE at the /app layout level so the
 * conversation survives every left-side navigation (filter, section, route). It
 * is a fixed, self-positioning dock — not an in-flow flex child — because the
 * page it overlays changes underneath it.
 *
 * WHICH shell it is — docked column, floating overlay, full-screen card — is
 * not decided here. `resolveAppLayout` (lib/app-layout.ts) arbitrates between
 * the sidebar, the main pane and this dock from one set of numbers, and the
 * pages read the same store to collapse their sidebar to the icon rail before
 * the dock is allowed to squeeze the content under its minimum; only when even
 * the rail can't keep the pane does the dock float. Mobile (<640px) is always
 * the full-screen card (the chat's own Close dismisses it).
 */
export function ChatPanel({ open, hidden, onClose, children }: { open: boolean; hidden?: boolean; onClose?: () => void; children: React.ReactNode }) {
  const { dock, dockWidth, sidebar } = useAppLayout(open);
  const sidebarWidth = useSidebarWidth();
  const dragging = useRef(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (panel.current && !panel.current.contains(document.activeElement) && !document.querySelector('[role="dialog"][data-state="open"]')) panel.current.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    if (!open || dock !== "full" || !panel.current) return;
    const previous: [HTMLElement, boolean][] = [];
    let current: HTMLElement | null = panel.current;
    while (current?.parentElement && current.parentElement !== document.body) {
      for (const sibling of current.parentElement.children) if (sibling !== current && sibling instanceof HTMLElement) { previous.push([sibling, sibling.inert]); sibling.inert = true; }
      current = current.parentElement;
    }
    return () => { for (const [element, inert] of previous) element.inert = inert; };
  }, [open, dock]);

  // Drag-resize of the docked column. Every move goes through the store so the
  // sidebar can collapse to the rail LIVE as the dock widens, and the fraction is
  // clamped there so the pane never drops under its minimum mid-drag.
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      if (!dragging.current) return;
      appLayoutStore.setDockFraction((window.innerWidth - ev.clientX) / window.innerWidth);
    };
    const onUp = (ev: PointerEvent) => {
      dragging.current = false;
      target.releasePointerCapture(ev.pointerId);
      appLayoutStore.commitDockFraction();
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }, []);

  // Reserve page space ONLY when docked (side) and open — overlay/full float
  // over content, closed reserves nothing. Runs before the early return so
  // toggling closed always resets the reservation (and cleanup on unmount).
  const reserved = open && dock === "side" ? dockWidth : 0;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(DOCK_WIDTH_VAR, `${reserved}px`);
    return () => root.style.setProperty(DOCK_WIDTH_VAR, "0px");
  }, [reserved]);

  // Closed means compact, never unmounted. The single composer and transport
  // survive navigation, focus expansion and window-size changes.

  // ONE stable element tree across all three modes (classes/styles vary) —
  // separate JSX branches would remount `children` when a window resize
  // crosses a mode boundary and wipe the conversation mid-chat.
  const modeClass =
    !open
      ? "fixed bottom-3 z-30 mx-auto overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-lg backdrop-blur-xl"
      : dock === "full"
      ? "fixed inset-0 z-40 bg-card"
      : dock === "overlay"
        ? // Floating: full height, flush right, lifted off the page by its shadow
          // and edge — no backdrop, the library stays live beside/under it.
          "fixed inset-y-0 right-0 z-40 w-[min(26rem,92vw)] border-l bg-card shadow-2xl"
        : "fixed right-0 z-30 border-l bg-card";

  return (
    <aside
      ref={panel}
      data-chat-panel
      tabIndex={-1}
      role={open && dock === "full" ? "dialog" : undefined}
      aria-modal={open && dock === "full" ? true : undefined}
      onKeyDown={event => {
        if (!open || event.defaultPrevented || event.nativeEvent.isComposing || !panel.current?.contains(event.target as Node)) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose?.(); }
        if (event.key === "Tab" && dock === "full") {
          const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(node => node.getClientRects().length > 0);
          const first = focusable[0], last = focusable.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}
      data-theme-picker-chat={dock}
      aria-label={open ? "Ask AI conversation" : "Ask about your library"}
      className={modeClass}
      style={{ ...(!open ? { bottom: "calc(12px + env(safe-area-inset-bottom, 0px))", left: sidebar === "mobile" ? 12 : sidebar === "icon" ? 60 : sidebarWidth + 12, right: 12, maxWidth: sidebar === "mobile" ? undefined : 360 } : dock === "side" ? { width: dockWidth, top: HEADER_PX, bottom: 0 } : {}), ...(!open && hidden ? { display: "none" } : {}) }}
    >
      {/* Drag handle on the panel's left edge — docked mode only. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        onPointerDown={onPointerDown}
        className={
          open && dock === "side"
            ? "absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-primary/20 active:bg-primary/30"
            : "hidden"
        }
      />
      <div className="h-full">{children}</div>
    </aside>
  );
}
