"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Chat width as a fraction of the viewport, drag-resizable within bounds. */
const MIN_FRACTION = 0.2;
const MAX_FRACTION = 0.4;
/** Below this the chat is unusable, so it becomes the floor of the resize —
 * and when even 40% of the viewport can't reach it, the panel switches to an
 * overlay instead of squeezing the library. */
const MIN_PX = 340;
const FRACTION_KEY = "bookmark-ai:chat-fraction";

/** Header height (px) the docked panel sits under — keep in sync with LibraryHeader. */
const HEADER_PX = 57;

/** The CSS custom property the docked (side) panel publishes on <html> so pages
 * can reserve right-side space and stay squeezed beside it (like Cloudflare's
 * assistant). 0px in overlay/full/closed states, where the panel floats over
 * content instead. Consumed by library-page's content shell. */
const DOCK_WIDTH_VAR = "--chat-dock-w";

type PanelMode = "side" | "overlay" | "full";

/**
 * Responsive shell for the AI chat, mounted ONCE at the /app layout level so the
 * conversation survives every left-side navigation (filter, section, route). It
 * is a fixed, self-positioning dock — not an in-flow flex child — because the
 * page it overlays changes underneath it:
 *  - wide screens: a docked, drag-resizable right column (20%–40% of the
 *    viewport, never narrower than MIN_PX) sitting below the header; it publishes
 *    its width via `--chat-dock-w` so the page reserves space and content stays
 *    visible beside it (content-squeeze, never hidden);
 *  - screens where 40% can't fit MIN_PX: a floating overlay column;
 *  - mobile (<640px): a full-screen card (the chat's own Close dismisses it).
 */
export function ChatPanel({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [fraction, setFraction] = useState(0.3);
  const [viewportW, setViewportW] = useState<number | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const saved = Number(localStorage.getItem(FRACTION_KEY));
    if (saved >= MIN_FRACTION && saved <= MAX_FRACTION) setFraction(saved);
    const onResize = () => setViewportW(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      if (!dragging.current) return;
      const next = (window.innerWidth - ev.clientX) / window.innerWidth;
      setFraction(Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, next)));
    };
    const onUp = (ev: PointerEvent) => {
      dragging.current = false;
      target.releasePointerCapture(ev.pointerId);
      setFraction((f) => {
        localStorage.setItem(FRACTION_KEY, String(f));
        return f;
      });
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }, []);

  // Until the viewport is known (first client render), fall back to the
  // docked mode with the stored fraction — corrected on the next tick.
  const w = viewportW ?? 1280;
  const mode: PanelMode = w < 640 ? "full" : w * MAX_FRACTION < MIN_PX ? "overlay" : "side";
  const width = Math.max(MIN_PX, Math.round(fraction * w));

  // Reserve page space ONLY when docked (side) and open — overlay/full float
  // over content, closed reserves nothing. Runs before the `!open` early return
  // so toggling closed always resets the reservation (and cleanup on unmount).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(DOCK_WIDTH_VAR, open && mode === "side" ? `${width}px` : "0px");
    return () => root.style.setProperty(DOCK_WIDTH_VAR, "0px");
  }, [open, mode, width]);

  if (!open) return null;

  // ONE stable element tree across all three modes (classes/styles vary) —
  // separate JSX branches would remount `children` when a window resize
  // crosses a mode boundary and wipe the conversation mid-chat.
  const modeClass =
    mode === "full"
      ? "fixed inset-0 z-40 bg-card"
      : mode === "overlay"
        ? "fixed inset-y-0 right-0 z-40 w-[min(26rem,92vw)] border-l bg-card shadow-2xl"
        : "fixed right-0 z-30 border-l bg-card";

  return (
    <aside
      className={modeClass}
      style={mode === "side" ? { width, top: HEADER_PX, bottom: 0 } : undefined}
    >
      {/* Drag handle on the panel's left edge — docked mode only. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        onPointerDown={onPointerDown}
        className={
          mode === "side"
            ? "absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-primary/20 active:bg-primary/30"
            : "hidden"
        }
      />
      <div className="h-full">{children}</div>
    </aside>
  );
}
