import { useEffect, useRef, useState } from "react";
import type { Bookmark, Session } from "@bookmark-ai/types";
import { searchBookmarks } from "../api";
import { usePreferences } from "../context/PreferencesContext";

export interface SearchState {
  query: string;
  setQuery: (q: string) => void;
  /** Keyword (exact) hits — always shown. */
  matches: Bookmark[];
  /** Semantic-only results — shown behind a "related" toggle. */
  related: Bookmark[];
  /** Saved sessions whose name/tabs match — their own results tab. */
  sessions: Session[];
  searching: boolean;
  /** True when the server blended without embeddings (keyword-only results). */
  keywordOnly: boolean;
  error: string | null;
}

/** Debounced hybrid search — one box, keyword + semantic blended server-side
 * (Reciprocal Rank Fusion) and sectioned into exact matches vs related. */
export function useSearch(): SearchState {
  const { serverTarget } = usePreferences();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Bookmark[]>([]);
  const [related, setRelated] = useState<Bookmark[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [searching, setSearching] = useState(false);
  const [keywordOnly, setKeywordOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);

  useEffect(() => {
    const id = ++runId.current;
    const q = query.trim();
    if (!q) {
      setMatches([]);
      setRelated([]);
      setSessions([]);
      setSearching(false);
      setKeywordOnly(false);
      setError(null);
      return;
    }
    setSearching(true);
    // 350ms: fast enough to feel as-you-type, slow enough not to embed
    // a Gemini query per keystroke.
    const timer = setTimeout(() => {
      searchBookmarks(q, "hybrid")
        .then((data) => {
          if (runId.current !== id) return;
          setMatches(data.results.filter((r) => r.exact).map((r) => r.bookmark));
          setRelated(data.results.filter((r) => !r.exact).map((r) => r.bookmark));
          setSessions(data.sessionResults?.map((r) => r.session) ?? []);
          setKeywordOnly(data.fallback === true);
          setError(null);
        })
        .catch((err: unknown) => {
          if (runId.current === id) setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (runId.current === id) setSearching(false);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [query, serverTarget]);

  return { query, setQuery, matches, related, sessions, searching, keywordOnly, error };
}
