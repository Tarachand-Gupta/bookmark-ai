import { useEffect, useState } from "react";
import { getDeviceLabel, setDeviceLabel } from "@/lib/device-id";
import { liveEnabledItem } from "@/lib/live-storage";
import { requestSetLiveEnabled } from "@/lib/messages";

/**
 * The authoritative on/off control for publishing this browser's open tabs
 * (§4.9). Default off (§5.1). Flipping it delegates to the background (which holds
 * the Clerk token): the background mirrors the flag into storage.local AND writes
 * the account flag server-side. When on, a compact rename field seeds/edits this
 * device's label — the popup is the only surface that knows the physical machine.
 * Copy avoids the banned words "sync"/"live"/"real-time" (§3.4).
 */
export function LiveTabsToggle() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [labelSaved, setLabelSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void liveEnabledItem.getValue().then(setEnabled);
    void getDeviceLabel().then(setLabel);
  }, []);

  async function toggle() {
    if (busy) return;
    const next = !enabled;
    setBusy(true);
    setError(null);
    setEnabled(next); // optimistic; corrected by the settled result below
    try {
      const result = await requestSetLiveEnabled(next);
      setEnabled(result.enabled);
      if (!result.ok) {
        setError(
          next
            ? "Couldn't turn this on — make sure you're signed in, then try again."
            : "Turned off here, but the server couldn't be reached to confirm.",
        );
      }
    } catch {
      setEnabled(!next); // background unreachable — revert the optimistic flip
      setError("Couldn't reach the extension background. Try reopening the popup.");
    } finally {
      setBusy(false);
    }
  }

  async function saveLabel() {
    await setDeviceLabel(label);
    setLabel(await getDeviceLabel());
    setLabelSaved(true);
    setTimeout(() => setLabelSaved(false), 1500);
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-3">
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={() => void toggle()}
          className="mt-0.5 size-4 shrink-0 accent-primary disabled:opacity-50"
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium leading-tight">Show this browser&rsquo;s open tabs</span>
          <span className="text-[11px] leading-snug text-muted-foreground">
            Sends the title, address, and icon of every open tab so you can pick one up on your
            phone. Private windows are never sent. Nothing is saved until you tap Save.
          </span>
        </span>
      </label>

      <p className="pl-6 text-[11px] leading-tight text-muted-foreground">
        {enabled ? "Showing this browser’s open tabs" : "Off"}
      </p>

      {enabled && (
        <div className="flex items-center gap-2 pl-6">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="This device"
            spellCheck={false}
            aria-label="This device's name"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={() => void saveLabel()}
            className="h-8 shrink-0 rounded-md bg-secondary px-3 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            {labelSaved ? "Saved" : "Save"}
          </button>
        </div>
      )}

      {error && (
        <p className="pl-6 text-[11px] leading-tight text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
