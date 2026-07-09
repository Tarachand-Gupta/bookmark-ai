import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { Bookmark } from "@bookmark-ai/types";
import { requestSaveBookmark } from "@/lib/messages";
import { ErrorNote } from "./components/ErrorNote";
import { SaveCard, type TabInfo } from "./components/SaveCard";
import { SavedResult } from "./components/SavedResult";
import { SettingsRow } from "./components/SettingsRow";

const AUTO_CLOSE_MS = 1200;

type Status = "idle" | "saving" | "saved" | "error";

export default function App() {
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [bookmark, setBookmark] = useState<Bookmark | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([active]) => {
        if (active?.url) {
          setTab({
            url: active.url,
            title: active.title,
            favIconUrl: active.favIconUrl,
          });
        }
      });
  }, []);

  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => window.close(), AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [status]);

  async function handleSave() {
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

  const savable = tab !== null && /^https?:/i.test(tab.url);

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
          B
        </span>
        <h1 className="text-sm font-semibold tracking-tight">Bookmark AI</h1>
      </header>

      {status === "saved" && bookmark ? (
        <SavedResult bookmark={bookmark} />
      ) : (
        <SaveCard
          tab={tab}
          saving={status === "saving"}
          disabled={!savable}
          onSave={() => void handleSave()}
        />
      )}

      {status === "error" && error && <ErrorNote message={error} />}

      <SettingsRow />
    </div>
  );
}
