"use client";

import { useSyncExternalStore } from "react";
import {
  createBookmarkTablePreferencesStore,
  defaultBookmarkTablePreferences,
} from "@/lib/bookmark-table-preferences";

const serverSnapshot = defaultBookmarkTablePreferences();
const store = createBookmarkTablePreferencesStore(() => window.localStorage);

function subscribe(notify: () => void) {
  const unsubscribe = store.subscribe(notify);
  const onStorage = (event: StorageEvent) => {
    try {
      if (event.storageArea === window.localStorage)
        store.receiveStorage(event.key, event.newValue);
    } catch {
      // Storage access can be revoked while this table is mounted.
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    unsubscribe();
    window.removeEventListener("storage", onStorage);
  };
}

export function useBookmarkTablePreferences() {
  const preferences = useSyncExternalStore(subscribe, store.getSnapshot, () => serverSnapshot);
  return { preferences, update: store.update, reset: store.reset };
}
