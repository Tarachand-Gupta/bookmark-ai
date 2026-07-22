import { useEffect, useRef, useState } from "react";
import { DEFAULT_LIVE_API_URL, liveApiUrlItem } from "@/lib/api";
import { requestSetLiveServer } from "@/lib/messages";

/**
 * Footer settings: a gear button that opens a small popover (no dep) above it.
 * The only field is the Live Sessions server URL — the API-server field is gone
 * from the UI (the build target sets the API origin; `apiUrlItem` is left
 * untouched in storage). Saving delegates to the background, which writes the
 * local mirror AND best-effort persists the choice to the account.
 */
export function SettingsPopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside-click / Escape — only while open.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Settings"
        aria-label="Settings"
        aria-expanded={open}
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4"
          aria-hidden="true"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-2 w-64 rounded-xl border bg-popover p-3 text-popover-foreground shadow-md">
          <LiveServerField />
        </div>
      )}
    </div>
  );
}

/** Live Sessions server URL: label + input + Save. Empty resets to the default;
 * saving routes through the background (SET_LIVE_SERVER). "Saved" confirms the
 * local write; a failed account sync is silent by design. */
function LiveServerField() {
  const [value, setValue] = useState(DEFAULT_LIVE_API_URL);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void liveApiUrlItem.getValue().then(setValue);
  }, []);

  async function persist() {
    const result = await requestSetLiveServer(value);
    if (result.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-muted-foreground uppercase">Live server</span>
      <div className="flex items-center gap-2">
        <input
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={DEFAULT_LIVE_API_URL}
          spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <button
          type="button"
          onClick={() => void persist()}
          className="h-8 shrink-0 rounded-md bg-secondary px-3 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}
