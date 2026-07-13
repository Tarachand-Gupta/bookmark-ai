import { useEffect, useRef, useState } from "react";
import type { Bookmark } from "@bookmark-ai/types";
import { searchBookmarks } from "../api";

export interface SearchState {
  query: string;
  setQuery: (q: string) => void;
  results: Bookmark[];
  searching: boolean;
  /** True when the server blended without embeddings (keyword-only results). */
  keywordOnly: boolean;
  error: string | null;
}

/** Debounced hybrid search — one box, keyword + semantic blended server-side
 * (Reciprocal Rank Fusion), most relevant first. The Search tab's data story. */
export function useSearch(): SearchState {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Bookmark[]>([]);
  const [searching, setSearching] = useState(false);
  const [keywordOnly, setKeywordOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);

  useEffect(() => {
    const id = ++runId.current;
    const q = query.trim();
    if (!q) {
      setResults([]);
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
          setResults(data.results.map((r) => r.bookmark));
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
  }, [query]);

  return { query, setQuery, results, searching, keywordOnly, error };
}
