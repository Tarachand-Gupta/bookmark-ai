import { useEffect, useRef, useState } from "react";
import type { Bookmark, SearchMode } from "@bookmark-ai/types";
import { searchBookmarks } from "../api";

export interface SearchState {
  query: string;
  setQuery: (q: string) => void;
  mode: SearchMode;
  setMode: (m: SearchMode) => void;
  results: Bookmark[];
  searching: boolean;
  error: string | null;
}

/** Debounced text/AI search — the Search tab's data story. */
export function useSearch(): SearchState {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("text");
  const [results, setResults] = useState<Bookmark[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef(0);

  useEffect(() => {
    const id = ++runId.current;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(
      () => {
        searchBookmarks(q, mode)
          .then((data) => {
            if (runId.current !== id) return;
            setResults(data.results.map((r) => r.bookmark));
            setError(null);
          })
          .catch((err: unknown) => {
            if (runId.current === id) setError(err instanceof Error ? err.message : String(err));
          })
          .finally(() => {
            if (runId.current === id) setSearching(false);
          });
      },
      mode === "ai" ? 450 : 250,
    );
    return () => clearTimeout(timer);
  }, [query, mode]);

  return { query, setQuery, mode, setMode, results, searching, error };
}
