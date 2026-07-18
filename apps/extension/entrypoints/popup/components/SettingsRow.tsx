import { useEffect, useState } from "react";
import { apiUrlItem, DEFAULT_API_URL, DEFAULT_LIVE_API_URL, liveApiUrlItem } from "@/lib/api";

/** One editable base-URL field (label + input + save button), reused for both
 * the main API base and the Live Sessions server base below. */
function UrlField({
  label,
  fallback,
  item,
}: {
  label: string;
  fallback: string;
  item: { getValue: () => Promise<string>; setValue: (v: string) => Promise<void> };
}) {
  const [value, setValue] = useState(fallback);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void item.getValue().then(setValue);
  }, [item]);

  async function persist() {
    await item.setValue(value.trim() || fallback);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-muted-foreground uppercase">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={fallback}
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

export function SettingsRow() {
  const [open, setOpen] = useState(false);

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
        <div className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-2">
          <UrlField label="API server" fallback={DEFAULT_API_URL} item={apiUrlItem} />
          <UrlField
            label="Live server"
            fallback={DEFAULT_LIVE_API_URL}
            item={liveApiUrlItem}
          />
        </div>
      )}
    </div>
  );
}
