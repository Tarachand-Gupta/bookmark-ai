"use client";

import { useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { LibraryFilters } from "@/lib/api";
import { AiChat } from "./ai-chat";
import { ChatPanel } from "./chat-panel";

/** Facet keys that live in the URL — must match library-page's FILTER_KEYS so a
 * chat-applied facet reads back identically on the page. */
const FILTER_KEYS = ["category", "browser", "device", "day", "tag", "from", "to"] as const;

/** The URL flag that opens the docked chat. Kept as its own param (not the
 * search `mode`) so the layout-level dock and the page's Ask AI button share a
 * single source of truth that survives navigation and refresh. */
const AI_PARAM = "ai";

/**
 * Mounts the Ask AI dock at the /app LAYOUT level — ONE instance that outlives
 * every left-side navigation (facet, section, and any future route), so the live
 * conversation (useChat state + active thread) is never torn down the way an
 * in-page mount was. Open/close is pure URL state (`?ai=1`), toggled with the
 * same shallow History API idiom the library page uses, so a refresh restores an
 * open panel and closing removes the param everywhere.
 */
export function AppChatDock() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const open = searchParams.get(AI_PARAM) === "1";
  // Seed a freshly-opened chat with the active search query (mirrored to ?q by
  // the library page). Only consumed on mount, so it never re-seeds mid-thread.
  const initialQuery = searchParams.get("q") ?? undefined;

  // Shallow History API push: updates the URL (and Next's useSearchParams
  // everywhere, including the still-mounted library page) WITHOUT an RSC
  // round-trip — the same instant-swap idiom library-page.tsx documents.
  const shallowPush = useCallback((url: string) => {
    window.history.pushState(null, "", url);
  }, []);

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete(AI_PARAM);
    shallowPush(params.size ? `${pathname}?${params}` : pathname);
  }, [searchParams, pathname, shallowPush]);

  // A chat result's "filter by this facet" jumps the library beside the open
  // chat: set the facet, drop the search, and KEEP the panel open (?ai stays).
  const applyFilter = useCallback(
    (next: LibraryFilters) => {
      const params = new URLSearchParams();
      for (const key of FILTER_KEYS) {
        if (next[key]) params.set(key, next[key]!);
      }
      params.set(AI_PARAM, "1");
      shallowPush(params.size ? `${pathname}?${params}` : pathname);
    },
    [pathname, shallowPush],
  );

  return (
    <ChatPanel open={open}>
      <AiChat initialQuery={initialQuery} onClose={close} onFilter={applyFilter} />
    </ChatPanel>
  );
}
