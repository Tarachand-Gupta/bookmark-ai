"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  DOCK_MAX_FRACTION,
  DOCK_MIN_FRACTION,
  INITIAL_APP_LAYOUT_STATE,
  layoutFromState,
  withDockFraction,
  withDockOpen,
  withSidebarOpen,
  withViewportWidth,
  type AppLayout,
  type AppLayoutState,
} from "@/lib/app-layout";

/**
 * The URL flag that opens the Ask AI dock (`?ai=1`). Shared by the layout-level
 * dock, the library's Ask AI button and the layout store so they can never drift.
 */
export const AI_PARAM = "ai";

const FRACTION_KEY = "bookmark-ai:chat-fraction";

/**
 * ONE module-level store for the inputs of `resolveAppLayout` — the measured
 * viewport, the dock's drag fraction, the user's sidebar toggle and the rule-4
 * override — so the dock (mounted at the /app layout) and each page's
 * `SidebarProvider` compute the same layout from the same numbers.
 *
 * It outlives page components on purpose: the Ask AI dock survives every
 * Home ↔ Library hop, and the sidebar the user collapsed beside it should too.
 *
 * Nothing is measured until the first subscriber arrives (a passive effect,
 * i.e. after hydration), so the server render and the first client render both
 * see INITIAL_APP_LAYOUT_STATE (viewport unknown → DEFAULT_VIEWPORT_PX) and
 * agree; the real width lands in the very next commit.
 */
let state: AppLayoutState = INITIAL_APP_LAYOUT_STATE;
const listeners = new Set<() => void>();
let bootstrapped = false;

function emit() {
  for (const listener of listeners) listener();
}

function update(next: AppLayoutState) {
  if (next === state) return;
  state = next;
  emit();
}

function measure() {
  update(withViewportWidth(state, window.innerWidth));
}

function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  const saved = Number(localStorage.getItem(FRACTION_KEY));
  let next = state;
  if (saved >= DOCK_MIN_FRACTION && saved <= DOCK_MAX_FRACTION) {
    next = { ...next, dockFraction: saved };
  }
  state = withViewportWidth(next, window.innerWidth);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    bootstrap();
    window.addEventListener("resize", measure);
    // The bootstrap above may have changed the state before this listener was
    // wired; React re-checks the snapshot right after subscribing, but any
    // OTHER subscriber added in the same commit needs the tick.
    emit();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("resize", measure);
  };
}

function getState() {
  return state;
}

function getServerState() {
  return INITIAL_APP_LAYOUT_STATE;
}

/** Actions — plain functions, safe to call from event handlers and effects. */
export const appLayoutStore = {
  /** Mirror of the dock's `?ai=1`; lets the store retire the override on close. */
  setDockOpen(open: boolean) {
    update(withDockOpen(state, open));
  },
  /** Live drag: clamped so the docked pane never drops under its minimum. */
  setDockFraction(fraction: number) {
    update(withDockFraction(state, fraction));
  },
  /** Drag end: persist whatever the clamp settled on. */
  commitDockFraction() {
    try {
      localStorage.setItem(FRACTION_KEY, String(state.dockFraction));
    } catch {
      // Storage unavailable (private mode) — the width just doesn't persist.
    }
  },
  /** The user's own sidebar toggle (the header trigger / ⌘B). */
  setSidebarOpen(open: boolean) {
    update(withSidebarOpen(state, open));
  },
};

function sameLayout(a: AppLayout, b: AppLayout): boolean {
  return (
    a.sidebar === b.sidebar &&
    a.dock === b.dock &&
    a.dockWidth === b.dockWidth &&
    a.contentWidth === b.contentWidth &&
    a.sidebarForced === b.sidebarForced
  );
}

/**
 * Subscribe to the resolved layout for a given selection of it. The snapshot is
 * cached by `equal` so a store change that doesn't move the selected fields —
 * every pointermove of a dock drag, for the pages — causes no re-render.
 *
 * `dockOpen` comes from the caller (its URL param), not the store's mirror, so
 * the render that flips `?ai` already lays out for it — the mirror catches up
 * in an effect and only matters for retiring the override.
 */
function useLayoutSelector<T>(
  dockOpen: boolean,
  select: (layout: AppLayout) => T,
  equal: (a: T, b: T) => boolean,
): T {
  useEffect(() => {
    appLayoutStore.setDockOpen(dockOpen);
  }, [dockOpen]);

  const cache = useRef<T | null>(null);
  const snapshotFrom = useCallback(
    (source: AppLayoutState) => {
      const next = select(layoutFromState(source, dockOpen));
      if (cache.current !== null && equal(cache.current, next)) return cache.current;
      cache.current = next;
      return next;
    },
    [dockOpen, select, equal],
  );
  return useSyncExternalStore(
    subscribe,
    () => snapshotFrom(getState()),
    () => snapshotFrom(getServerState()),
  );
}

const identity = (layout: AppLayout) => layout;

/** The full resolved layout — widths included. The dock reads this. */
export function useAppLayout(dockOpen: boolean): AppLayout {
  return useLayoutSelector(dockOpen, identity, sameLayout);
}

export type AppShellLayout = Pick<AppLayout, "sidebar" | "dock" | "sidebarForced">;

const selectShell = (layout: AppLayout): AppShellLayout => ({
  sidebar: layout.sidebar,
  dock: layout.dock,
  sidebarForced: layout.sidebarForced,
});

const sameShell = (a: AppShellLayout, b: AppShellLayout) =>
  a.sidebar === b.sidebar && a.dock === b.dock && a.sidebarForced === b.sidebarForced;

/**
 * The discrete part of the layout a page needs to drive its `SidebarProvider`
 * (which mode the sidebar is in, and whether that was forced). No widths, so a
 * dock drag never re-renders the page — the reserved space rides the
 * `--chat-dock-w` CSS variable instead (see ChatPanel).
 */
export function useAppShellLayout(dockOpen: boolean): AppShellLayout & {
  /** Hand to `SidebarProvider`'s `onOpenChange`. */
  setSidebarOpen: (open: boolean) => void;
} {
  const shell = useLayoutSelector(dockOpen, selectShell, sameShell);
  return useMemo(() => ({ ...shell, setSidebarOpen: appLayoutStore.setSidebarOpen }), [shell]);
}
