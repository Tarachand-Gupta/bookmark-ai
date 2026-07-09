import { useEffect, useState } from "react";
import { apiUrlItem, DEFAULT_API_URL } from "@/lib/api";

export function SettingsRow() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(DEFAULT_API_URL);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void apiUrlItem.getValue().then(setValue);
  }, []);

  async function persist() {
    await apiUrlItem.setValue(value.trim() || DEFAULT_API_URL);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? "Hide settings" : "API settings"}
      </button>
      {open && (
        <div className="flex items-center gap-2 rounded-xl border bg-muted/40 p-2">
          <input
            type="url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={DEFAULT_API_URL}
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
      )}
    </div>
  );
}
