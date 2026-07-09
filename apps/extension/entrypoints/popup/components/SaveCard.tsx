import { useState } from "react";
import { Spinner } from "./Spinner";

export interface TabInfo {
  url: string;
  title?: string;
  favIconUrl?: string;
}

interface SaveCardProps {
  tab: TabInfo | null;
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
}

export function SaveCard({ tab, saving, disabled, onSave }: SaveCardProps) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const showFavicon = tab?.favIconUrl && !faviconFailed;

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 text-card-foreground shadow-sm">
      <div className="flex items-center gap-3">
        {showFavicon ? (
          <img
            src={tab.favIconUrl}
            alt=""
            className="size-8 shrink-0 rounded-md border bg-muted p-1"
            onError={() => setFaviconFailed(true)}
          />
        ) : (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
            {"⚑"}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {tab?.title || tab?.url || "No active tab"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {tab?.url ?? "Open a page to bookmark it"}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || saving}
        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
      >
        {saving && <Spinner />}
        {saving ? "Saving…" : "Save bookmark"}
      </button>
      {!disabled || tab === null ? null : (
        <p className="text-xs text-muted-foreground">
          This page can’t be bookmarked.
        </p>
      )}
    </div>
  );
}
