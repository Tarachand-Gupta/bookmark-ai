import { useCallback, useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import { useShareIntentContext, type ShareIntent } from "expo-share-intent";
import { createBookmark, detectSource, getBookmarkByUrl } from "../api";

/**
 * "Save to Bookmark AI" from the system share sheet (see the expo-share-intent
 * block in app.json for the native side: the iOS share extension target and the
 * Android ACTION_SEND filters).
 *
 * This module owns the JS half:
 *   1. URL parsing — shared text is prose as often as it is a bare link.
 *   2. `usePendingSharedLink` — capture the incoming share into React state
 *      ABOVE the auth gate, so a signed-out share survives sign-in.
 *   3. `useSharedLinkSave` — auto-save it and drive the confirmation banner,
 *      handing the URL back to the caller if the API call fails.
 */

/** Frozen at module scope — the hook behind the provider re-reads `options` on
 * every render, so an inline literal would churn its effects. (The library's
 * `ShareIntentOptions` type isn't re-exported from its entrypoint; the
 * provider's own prop type checks this structurally.) */
export const SHARE_INTENT_OPTIONS = { debug: __DEV__ } as const;

/** "https://x.co" from "x.co"; null when the text can't be a URL at all.
 * Shared by the Add Bookmark sheet's own input validation. */
export function normalizeUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed) || !trimmed.includes(".")) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    new URL(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/** Wrapping punctuation a link picks up from prose: "(https://x.co/a)," etc. */
const trimEdges = (token: string): string =>
  token.replace(/^[^A-Za-z0-9]+/, "").replace(/[.,;:!?"'’”)\]}>]+$/, "");

/** A token that looks like a bare domain with a path/query boundary. */
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}([/?#]|$)/i;

/**
 * The first link in a block of shared text. Browsers and chat apps rarely share
 * a naked URL — Chrome on Android sends "<page title>\n<url>", and people share
 * "Check this out https://vercel.com/blog" — so scan token by token, preferring
 * an explicit scheme before falling back to a bare domain.
 */
export function extractFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const tokens = text.split(/\s+/).filter(Boolean).map(trimEdges);
  for (const token of tokens) {
    if (/^(https?:\/\/|www\.)/i.test(token)) {
      const url = normalizeUrl(token);
      if (url) return url;
    }
  }
  for (const token of tokens) {
    if (BARE_DOMAIN.test(token)) {
      const url = normalizeUrl(token);
      if (url) return url;
    }
  }
  return null;
}

export interface SharedLink {
  url: string;
  /** The page title, when the sharing app sent one (Android EXTRA_SUBJECT, iOS
   * `NSExtensionActivationSupportsWebPageWithMaxCount` page metadata). The
   * server scrapes a better one anyway, so this is only a first paint. */
  title?: string;
}

/** The link inside a share intent, or null when it carried no link at all
 * (a plain-text or file share — nothing to bookmark). */
export function sharedLink(intent: ShareIntent): SharedLink | null {
  // `webUrl` is expo-share-intent's own extraction, which only matches links
  // that already start with http — our parser covers the rest (www./bare host).
  const url =
    (intent.webUrl ? normalizeUrl(intent.webUrl) : null) ?? extractFirstUrl(intent.text);
  if (!url) return null;
  const title = intent.meta?.title?.trim();
  return title ? { url, title } : { url };
}

/**
 * Captures an incoming share the moment it arrives — before the auth gate has
 * decided what to render — and moves ownership to React state here, clearing
 * the native side so re-foregrounding can't replay it.
 *
 * Holding it in memory (never persisted — a share can be a private link) is
 * what makes the signed-out path work: Clerk's SSO round trip backgrounds the
 * app, which resets expo-share-intent's own state, but this survives because
 * the component holding it stays mounted across the sign-in → app swap.
 */
export function usePendingSharedLink(): { pending: SharedLink | null; clear: () => void } {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [pending, setPending] = useState<SharedLink | null>(null);
  // resetShareIntent is re-created every provider render; keep it out of deps.
  const reset = useRef(resetShareIntent);
  reset.current = resetShareIntent;

  useEffect(() => {
    if (!hasShareIntent) return;
    const link = sharedLink(shareIntent);
    reset.current();
    if (link) setPending(link);
  }, [hasShareIntent, shareIntent]);

  return { pending, clear: useCallback(() => setPending(null), []) };
}

export interface ShareNotice {
  url: string;
  /** null until the POST returns; upgraded again when the scrape lands. */
  title: string | null;
  saving: boolean;
}

/** How long after the save to re-read the bookmark for its scraped title —
 * same delay the Add sheet uses to refresh the Library after a save. */
const ENRICH_DELAY_MS = 4000;
/** Banner lifetime after the title settles. */
const DISMISS_AFTER_MS = 4000;

/**
 * Auto-saves a captured share, then keeps the confirmation banner's copy up to
 * date as the server enriches the bookmark.
 *
 * A failure is NOT swallowed: `onFailed` gets the URL back so the caller can
 * open the Add Bookmark sheet prefilled with it, which means a share can never
 * be lost between the share sheet and the library.
 */
export function useSharedLinkSave({
  pending,
  onConsumed,
  onSaved,
  onFailed,
}: {
  /** The captured share, or null when there is nothing to save (also null while
   * signed out — the caller withholds it until there is a session). */
  pending: SharedLink | null;
  /** Called once the save has been taken over from `pending` (success or not). */
  onConsumed: () => void;
  onSaved: () => void;
  onFailed: (link: SharedLink) => void;
}): { notice: ShareNotice | null; dismiss: () => void } {
  const [notice, setNotice] = useState<ShareNotice | null>(null);
  // Callbacks are inline arrows at the call site; refs keep the save effect
  // keyed on `pending` alone.
  const callbacks = useRef({ onConsumed, onSaved, onFailed });
  callbacks.current = { onConsumed, onSaved, onFailed };
  // Deliberately object identity, not the URL: `onConsumed` nulls `pending` out
  // mid-flight (that is how a second share queues behind this one), and sharing
  // the SAME link twice must still re-save it — each capture is a new object.
  const started = useRef<SharedLink | null>(null);
  const mounted = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      mounted.current = false;
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );

  useEffect(() => {
    if (!pending || started.current === pending) return;
    started.current = pending;
    const link = pending;
    setNotice({ url: link.url, title: link.title ?? null, saving: true });
    // Release the capture now that the save owns it. Note this re-renders the
    // owner with `pending: null`, which is why the save below is NOT tied to
    // this effect's lifetime — a cleanup must never cancel an in-flight save.
    callbacks.current.onConsumed();

    void (async () => {
      try {
        const { bookmark } = await createBookmark({
          url: link.url,
          title: link.title,
          ...detectSource(),
          savedAt: new Date().toISOString(),
        });
        if (!mounted.current) return;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setNotice({ url: link.url, title: bookmark.title ?? null, saving: false });
        callbacks.current.onSaved();
        // The scrape lands just after the save returns; pick the real title up
        // without making the user pull to refresh.
        timers.current.push(
          setTimeout(() => {
            void getBookmarkByUrl(link.url)
              .then(({ bookmarks }) => {
                const enriched = bookmarks[0]?.title;
                if (!mounted.current || !enriched) return;
                setNotice((current) =>
                  current?.url === link.url ? { ...current, title: enriched } : current,
                );
              })
              .catch(() => {
                /* keep whatever title the banner already shows */
              });
            timers.current.push(
              setTimeout(() => {
                if (mounted.current) setNotice((current) => (current?.url === link.url ? null : current));
              }, DISMISS_AFTER_MS),
            );
          }, ENRICH_DELAY_MS),
        );
      } catch {
        if (!mounted.current) return;
        // Nothing is lost — hand it to the Add sheet instead of a dead end.
        setNotice(null);
        callbacks.current.onFailed(link);
      }
    })();
  }, [pending]);

  return { notice, dismiss: useCallback(() => setNotice(null), []) };
}
