"use client";

import { useEffect, useRef } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { appLayoutStore, useSidebarWidth } from "@/hooks/use-app-layout";
import { SIDEBAR_EXPANDED_PX, SIDEBAR_MIN_PX, SIDEBAR_MAX_PX } from "@/lib/app-layout";

/** The sidebar's edge is a WAI-ARIA window splitter, separate from its toggle. */
export function SidebarResizeHandle() {
  const { isMobile, state, setResizing } = useSidebar();
  const width = useSidebarWidth();
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  useEffect(() => () => setResizing(false), [setResizing]);
  if (isMobile || state !== "expanded") return null;

  const finish = (cancel = false) => {
    if (!drag.current) return;
    if (cancel) appLayoutStore.setSidebarWidth(drag.current.width);
    else appLayoutStore.commitSidebarWidth();
    drag.current = null;
    setResizing(false);
  };

  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_MIN_PX}
      aria-valuemax={SIDEBAR_MAX_PX}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels`}
      tabIndex={0}
      title="Drag to resize. Arrow keys adjust width; double-click to reset."
      className="absolute inset-y-0 -right-1.5 z-30 w-3 touch-none cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary/40 focus-visible:after:bg-ring"
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { pointerId: event.pointerId, x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
        setResizing(true);
      }}
      onPointerMove={event => {
        if (drag.current?.pointerId !== event.pointerId) return;
        appLayoutStore.setSidebarWidth(drag.current.width + event.clientX - drag.current.x);
      }}
      onPointerUp={() => finish()}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => finish()}
      onDoubleClick={() => {
        appLayoutStore.setSidebarWidth(SIDEBAR_EXPANDED_PX);
        appLayoutStore.commitSidebarWidth();
      }}
      onKeyDown={event => {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          finish(true);
          return;
        }
        const step = event.shiftKey ? 32 : 8;
        const next = event.key === "ArrowLeft" ? width - step
          : event.key === "ArrowRight" ? width + step
          : event.key === "Home" ? SIDEBAR_MIN_PX
          : event.key === "End" ? SIDEBAR_MAX_PX
          : event.key === "Enter" ? SIDEBAR_EXPANDED_PX : null;
        if (next === null) return;
        event.preventDefault();
        appLayoutStore.setSidebarWidth(next);
        appLayoutStore.commitSidebarWidth();
      }}
    />
  );
}
