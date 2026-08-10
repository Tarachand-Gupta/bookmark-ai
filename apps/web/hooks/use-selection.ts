"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface SelectionState {
  /** Ids currently ticked, in no particular order. */
  ids: ReadonlySet<string>;
  count: number;
  has: (id: string) => boolean;
  /**
   * Tick/untick one item. Pass `{ shiftKey, order }` from a click handler to get
   * range selection: everything between the last-touched id and this one, in the
   * order the list is rendered, is SET (never cleared) — the same behaviour as a
   * file manager, and the reason `order` has to be the flattened visible order.
   */
  toggle: (id: string, opts?: { shiftKey?: boolean; order?: readonly string[] }) => void;
  /** Tick exactly these (the bar's "select all" style callers). */
  set: (ids: readonly string[]) => void;
  clear: () => void;
  /**
   * Show the checkboxes even with nothing selected. Hover reveals them on
   * pointer devices, but there is no hover on touch, so <md offers an explicit
   * "Select" button that flips this.
   */
  mode: boolean;
  setMode: (on: boolean) => void;
  /** Checkboxes should be visible right now (something is selected, or mode is on). */
  active: boolean;
}

/**
 * Bulk-selection state for one page's worth of rows. Deliberately NOT in the URL:
 * a selection is a transient gesture, not a shareable view, and putting it in the
 * query string would make every tick a history entry.
 *
 * `scopeKey` is what the selection belongs to — the filter set, the section, and
 * whether a search is running. Any change to it drops the selection, because the
 * ids on screen have been replaced and "3 selected" over a different list is a
 * loaded gun (the Delete button would act on rows the user can no longer see).
 *
 * Escape clears, from anywhere on the page — except while focus is inside a
 * dialog, sheet or popover, where Escape belongs to that surface. Cancelling the
 * delete confirmation must not also throw away the selection it was about to act
 * on. The listener is attached only while something is selected.
 */
export function useSelection(scopeKey: string): SelectionState {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const [mode, setModeState] = useState(false);
  /** Range-select anchor: the id of the last plain (non-shift) toggle. */
  const anchor = useRef<string | null>(null);

  // Reset on scope change. An effect, not a render-time compare, so the two
  // state updates land together and no render ever sees a stale selection.
  useEffect(() => {
    setIds((prev) => (prev.size === 0 ? prev : new Set()));
    setModeState(false);
    anchor.current = null;
  }, [scopeKey]);

  const clear = useCallback(() => {
    setIds((prev) => (prev.size === 0 ? prev : new Set()));
    setModeState(false);
    anchor.current = null;
  }, []);

  const toggle = useCallback(
    (id: string, opts?: { shiftKey?: boolean; order?: readonly string[] }) => {
      const from = anchor.current;
      if (opts?.shiftKey && from && opts.order) {
        const a = opts.order.indexOf(from);
        const b = opts.order.indexOf(id);
        if (a !== -1 && b !== -1) {
          const [start, end] = a <= b ? [a, b] : [b, a];
          setIds((prev) => {
            const next = new Set(prev);
            for (let i = start; i <= end; i++) next.add(opts.order![i]);
            return next;
          });
          anchor.current = id;
          return;
        }
      }
      anchor.current = id;
      setIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [],
  );

  const set = useCallback((next: readonly string[]) => {
    setIds(new Set(next));
  }, []);

  const setMode = useCallback((on: boolean) => {
    setModeState(on);
    if (!on) {
      setIds((prev) => (prev.size === 0 ? prev : new Set()));
      anchor.current = null;
    }
  }, []);

  useEffect(() => {
    if (ids.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as Element | null;
      if (target?.closest?.("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]")) {
        return;
      }
      clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids.size, clear]);

  const has = useCallback((id: string) => ids.has(id), [ids]);

  return useMemo(
    () => ({
      ids,
      count: ids.size,
      has,
      toggle,
      set,
      clear,
      mode,
      setMode,
      active: ids.size > 0 || mode,
    }),
    [ids, has, toggle, set, clear, mode, setMode],
  );
}
