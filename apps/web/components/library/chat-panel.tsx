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

type PanelMode = "side" | "overlay" | "full";

/**
 * Responsive shell for the AI chat:
 *  - wide screens: a docked, drag-resizable right sidebar (20%–40% of the
 *    viewport, never narrower than MIN_PX) — the library stays usable beside it;
 *  - screens where 40% can't fit MIN_PX: a fixed overlay sidebar;
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

  if (!open) return null;

  // Until the viewport is known (first client render), fall back to the
  // docked mode with the stored fraction — corrected on the next tick.
  const w = viewportW ?? 1280;
  const mode: PanelMode = w < 640 ? "full" : w * MAX_FRACTION < MIN_PX ? "overlay" : "side";
  const width = Math.max(MIN_PX, Math.round(fraction * w));

  // ONE stable element tree across all three modes (classes/styles vary) —
  // separate JSX branches would remount `children` when a window resize
  // crosses a mode boundary and wipe the conversation mid-chat.
  const modeClass =
    mode === "full"
      ? "fixed inset-0 z-40 bg-card"
      : mode === "overlay"
        ? "fixed inset-y-0 right-0 z-40 w-[min(26rem,92vw)] border-l bg-card shadow-2xl"
        : "relative shrink-0 border-l bg-card";

  return (
    <aside className={modeClass} style={mode === "side" ? { width } : undefined}>
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
      <div
        className={mode === "side" ? "sticky" : "h-full"}
        style={
          mode === "side"
            ? { top: HEADER_PX, height: `calc(100vh - ${HEADER_PX}px)` }
            : undefined
        }
      >
        {children}
      </div>
    </aside>
  );
}
