import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { Bookmark } from "@bookmark-ai/types";
import { getWebBaseUrl, DEFAULT_WEB_URL } from "@/lib/api";
import { requestSaveBookmark, requestSaveSession } from "@/lib/messages";
import { AuthStatus } from "./components/AuthStatus";
import { ErrorNote } from "./components/ErrorNote";
import { SaveCard, type TabInfo } from "./components/SaveCard";
import { SavedResult } from "./components/SavedResult";
import { SettingsRow } from "./components/SettingsRow";
import { Spinner } from "./components/Spinner";

const AUTO_CLOSE_MS = 1200;

type Status = "idle" | "saving" | "saved" | "savingSession" | "error";

export default function App() {
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [tabCount, setTabCount] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [bookmark, setBookmark] = useState<Bookmark | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webUrl, setWebUrl] = useState<string>(DEFAULT_WEB_URL);

  useEffect(() => {
    void browser.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
      if (active?.url) {
        setTab({ url: active.url, title: active.title, favIconUrl: active.favIconUrl });
      }
    });
    // Count restorable tabs across all windows for the session button label.
    void browser.tabs
      .query({})
      .then((tabs) => setTabCount(tabs.filter((t) => t.url && /^https?:/i.test(t.url)).length));
    void getWebBaseUrl().then(setWebUrl);
  }, []);

  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => window.close(), AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [status]);

  async function handleSaveBookmark() {
    if (!tab || status === "saving") return;
    setStatus("saving");
    setError(null);
    const result = await requestSaveBookmark(tab.url, tab.title);
    if (result.ok) {
      setBookmark(result.bookmark);
      setStatus("saved");
    } else {
      setError(result.error);
      setStatus("error");
    }
  }

  async function handleSaveSession() {
    if (status === "savingSession") return;
    setStatus("savingSession");
    setError(null);
    const result = await requestSaveSession();
    if (result.ok) {
      // The background script now closes the windows and opens the web app;
      // the popup disappears with its window.
      window.close();
    } else {
      setError(result.error);
      setStatus("error");
    }
  }

  function openWebsite() {
    void browser.tabs.create({ url: webUrl });
    window.close();
  }

  const savable = tab !== null && /^https?:/i.test(tab.url);
  const busy = status === "saving" || status === "savingSession";

  return (
    <div className="flex min-w-[20rem] flex-col gap-3 p-4">
      <header className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
          B
        </span>
        <h1 className="text-sm font-semibold tracking-tight">Bookmark AI</h1>
      </header>

      {status === "saved" && bookmark ? (
        <SavedResult bookmark={bookmark} />
      ) : (
        <>
          {/* Primary action 1 — bookmark the current tab. */}
          <SaveCard
            tab={tab}
            saving={status === "saving"}
            disabled={!savable || busy}
            onSave={() => void handleSaveBookmark()}
          />

          {/* Primary action 2 — save the whole window session and close it. */}
          <button
            type="button"
            onClick={() => void handleSaveSession()}
            disabled={busy || !tabCount}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border bg-secondary text-sm font-medium text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80 disabled:pointer-events-none disabled:opacity-50"
          >
            {status === "savingSession" && <Spinner />}
            {status === "savingSession"
              ? "Saving session…"
              : `Save session & close${tabCount ? ` (${tabCount} tab${tabCount === 1 ? "" : "s"})` : ""}`}
          </button>
        </>
      )}

      {status === "error" && error && <ErrorNote message={error} />}

      <SettingsRow />

      <footer className="mt-1 flex items-center justify-between gap-2 border-t pt-2">
        <AuthStatus webUrl={webUrl} />
        <button
          type="button"
          onClick={openWebsite}
          className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Open website ↗
        </button>
      </footer>
    </div>
  );
}
