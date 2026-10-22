"use client";

import { useSyncExternalStore } from "react";
import { BOOKMARK_VIEW_BREAKPOINT, createBookmarkViewStore, resolveBookmarkView } from "@/lib/bookmark-view";

const store = createBookmarkViewStore(() => window.localStorage);
let initialized = false;

function subscribe(listener: () => void) {
  // Defer all browser access until after hydration. One lifetime listener also
  // keeps the preference fresh while navigating through pages without lists.
  if (!initialized) {
    initialized = true;
    store.refresh();
    window.addEventListener("storage", (event) => {
      try {
        if (event.storageArea !== window.localStorage) return;
        store.receiveStorage(event.key, event.newValue);
      } catch { /* Storage can be disabled by browser policy. */ }
    });
  }
  return store.subscribe(listener);
}
const serverChoice = () => null;
const serverNarrow = () => false;
const wideQuery = `(min-width: ${BOOKMARK_VIEW_BREAKPOINT}px)`;
const isNarrow = () => !window.matchMedia(wideQuery).matches;
function subscribeWidth(listener: () => void) {
  const query = window.matchMedia(wideQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Every list uses one viewport default; container CSS adapts its row details. */
export function useBookmarkView() {
  const preference = useSyncExternalStore(subscribe, store.getSnapshot, serverChoice);
  const narrow = useSyncExternalStore(subscribeWidth, isNarrow, serverNarrow);
  return {
    view: resolveBookmarkView(preference, narrow ? 0 : BOOKMARK_VIEW_BREAKPOINT),
    changeView: store.set,
    automatic: preference === null,
  };
}
