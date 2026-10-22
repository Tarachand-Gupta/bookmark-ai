"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { LibraryFilters } from "@/lib/api";
import { AI_PARAM } from "@/hooks/use-app-layout";
import { AiChat } from "./ai-chat";
import { ChatPanel } from "./chat-panel";
import { useAuth } from "@/lib/auth";
import type { ChatContext } from "@bookmark-ai/types";

/** Facet keys that live in the URL — must match library-page's FILTER_KEYS so a
 * chat-applied facet reads back identically on the page. */
const FILTER_KEYS = ["category", "browser", "device", "day", "tag", "from", "to", "folderId", "includeSubfolders", "categoryId", "tagId", "readingState"] as const;

// The `?ai=1` flag (AI_PARAM) is kept as its own param (not the search `mode`)
// so the layout-level dock, the page's Ask AI button and the layout store share
// a single source of truth that survives navigation and refresh.

/**
 * Mounts the Ask AI dock at the /app LAYOUT level — ONE instance that outlives
 * every left-side navigation (facet, section, and any future route), so the live
 * conversation (useChat state + active thread) is never torn down the way an
 * in-page mount was. Open/close is pure URL state (`?ai=1`), toggled with the
 * same shallow History API idiom the library page uses, so a refresh restores an
 * open panel and closing removes the param everywhere.
 */
export function AppChatDock() {
  const { userId } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const open = searchParams.get(AI_PARAM) === "1";
  const [blocked, setBlocked] = useState(false);
  const [selectionContext, setSelectionContext] = useState<ChatContext>();
  const [requestedContext, setRequestedContext] = useState<{ id: string; context: ChatContext }>();
  const invoking = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const inspect = () => setBlocked(!!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"], [data-composer-blocked="true"]'));
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state", "data-composer-blocked"] });
    inspect(); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ context?: ChatContext; open?: boolean; adopt?: boolean }>).detail;
      setSelectionContext(detail.context);
      if (detail.adopt && detail.context) setRequestedContext({ id: crypto.randomUUID(), context: detail.context });
      if (detail.open) { const params = new URLSearchParams(window.location.search); params.set(AI_PARAM, "1"); window.history.pushState(null, "", `${window.location.pathname}?${params}`); }
    };
    window.addEventListener("bookmark-chat-context", receive);
    return () => window.removeEventListener("bookmark-chat-context", receive);
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty("--floating-composer-h", !open && !blocked ? "calc(80px + env(safe-area-inset-bottom, 0px))" : "0px");
    return () => document.documentElement.style.setProperty("--floating-composer-h", "0px");
  }, [open, blocked]);
  const folderId = searchParams.get("folderId");
  const suggestedContext: ChatContext | undefined = selectionContext ?? (folderId && folderId !== "unsorted" ? { type: "folder", folderId, includeSubfolders: searchParams.get("includeSubfolders") !== "false" } : undefined);

  // Shallow History API push: updates the URL (and Next's useSearchParams
  // everywhere, including the still-mounted library page) WITHOUT an RSC
  // round-trip — the same instant-swap idiom library-page.tsx documents.
  const shallowPush = useCallback((url: string) => {
    window.history.pushState(null, "", url);
  }, []);

  const close = useCallback(() => {
    const panel = document.querySelector<HTMLElement>("[data-chat-panel]");
    const trigger = invoking.current;
    // The compact composer can itself open the conversation. Returning focus
    // to its textarea would immediately run focus-to-open again (and keep the
    // mobile keyboard up), so return to the compact shell in that case.
    const focusTarget = trigger?.isConnected && !panel?.contains(trigger) ? trigger : panel;
    if (document.activeElement instanceof HTMLElement && panel?.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    invoking.current = null;
    const params = new URLSearchParams(window.location.search);
    params.delete(AI_PARAM);
    shallowPush(params.size ? `${window.location.pathname}?${params}` : window.location.pathname);
    requestAnimationFrame(() => {
      // A new user action may have reopened it before this frame.
      if (new URLSearchParams(window.location.search).get(AI_PARAM) !== "1") {
        focusTarget?.focus({ preventScroll: true });
      }
    });
  }, [shallowPush]);
  const show = useCallback(() => {
    if (open) return;
    invoking.current = document.activeElement as HTMLElement | null;
    const params = new URLSearchParams(searchParams);
    params.set(AI_PARAM, "1"); shallowPush(`${pathname}?${params}`);
  }, [open, searchParams, pathname, shallowPush]);

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
    <ChatPanel open={open} hidden={blocked || !userId} onClose={close}>
      {userId && <AiChat key={userId} accountId={userId} open={open} onOpen={show} onClose={close} onFilter={applyFilter} suggestedContext={suggestedContext} requestedContext={requestedContext} />}
    </ChatPanel>
  );
}
