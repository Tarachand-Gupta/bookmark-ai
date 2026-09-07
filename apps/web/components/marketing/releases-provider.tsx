"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { appReleasesResponseSchema, type AppReleaseMap } from "@bookmark-ai/types";

/**
 * The published release records (`GET /api/app/releases`, public, server-cached
 * 5 min), fetched once per page and shared by every Download button, so the
 * owner can re-point a download from Settings → Releases without a deploy.
 *
 * `null` = not loaded (or failed) — buttons then use their static tag URL, so
 * the page is fully usable before, without, or despite the request.
 */
const ReleasesContext = createContext<AppReleaseMap | null>(null);

export function ReleasesProvider({ children }: { children: React.ReactNode }) {
  const [releases, setReleases] = useState<AppReleaseMap | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/app/releases", { signal: controller.signal });
        if (!res.ok) return;
        const parsed = appReleasesResponseSchema.safeParse(await res.json());
        if (parsed.success) setReleases(parsed.data.releases);
      } catch {
        // Offline, aborted, or a bad body — the static URLs stay in place.
      }
    })();
    return () => controller.abort();
  }, []);

  return <ReleasesContext.Provider value={releases}>{children}</ReleasesContext.Provider>;
}

export function useReleases(): AppReleaseMap | null {
  return useContext(ReleasesContext);
}
