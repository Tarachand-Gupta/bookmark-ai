import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { DEFAULT_WEB_URL, getWebBaseUrl } from "@/lib/api";
import { getDeviceLabel, setDeviceLabel } from "@/lib/device-id";
import { liveEnabledItem } from "@/lib/live-storage";
import { requestLivePushNow, requestSetLiveEnabled } from "@/lib/messages";

/**
 * The authoritative on/off control for publishing this browser's open tabs
 * (§4.9). Default off (§5.1). Collapsed to a single line — a real switch that
 * flips publishing plus a chevron that expands the explanatory copy, the device
 * rename field, and a link to the live view. Flipping the switch delegates to
 * the background (which holds the Clerk token): it mirrors the flag into
 * storage.local AND writes the account flag server-side. Copy avoids the banned
 * words "sync"/"live"/"real-time" (§3.4).
 */
export function LiveTabsToggle() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [label, setLabel] = useState("");
  const [labelSaved, setLabelSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webUrl, setWebUrl] = useState(DEFAULT_WEB_URL);

  useEffect(() => {
    void liveEnabledItem.getValue().then(setEnabled);
    void getDeviceLabel().then(setLabel);
    void getWebBaseUrl().then(setWebUrl);
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
    // The rename carries no tab event, so nothing would carry it to the mirror
    // until the next tab change — force an immediate push (no-op when off).
    void requestLivePushNow();
    setTimeout(() => setLabelSaved(false), 1500);
  }

  function openLive() {
    void browser.tabs.create({ url: `${webUrl}/app?section=live` });
    window.close();
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* View button sits OUTSIDE the card so it reads as a shortcut to the web
          view, not part of the on/off control. */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={openLive}
          title="View live tabs"
          aria-label="View live tabs"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>

      <div className="rounded-xl border bg-muted/40">
        {/* Collapsed row: clicking anywhere but the switch expands the card. */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setExpanded((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setExpanded((o) => !o);
            }
          }}
          aria-expanded={expanded}
          className="flex cursor-pointer items-center gap-2.5 p-3"
        >
          <Switch checked={enabled} disabled={busy} onToggle={() => void toggle()} />
          <span className="flex-1 text-sm font-medium leading-tight">Share as live tabs</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        {expanded && (
          <div className="flex flex-col gap-2 border-t px-3 pb-3 pt-2">
            <p className="text-[11px] leading-snug text-muted-foreground">
              Sends the title, address, and icon of every open tab so you can pick one up on your
              phone. Private windows are never sent. Nothing is saved until you tap Save.
            </p>

            <div className="flex items-center gap-2">
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

            <button
              type="button"
              onClick={openLive}
              className="self-start text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Open live tabs ↗
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="text-[11px] leading-tight text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A pill toggle switch (not a checkbox): `role="switch"` + a knob that slides on
 * the primary track when on. Stops click propagation so toggling never also
 * expands the enclosing row.
 */
function Switch({
  checked,
  disabled,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Share as live tabs"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-input"
      }`}
    >
      <span
        className={`inline-block size-4 transform rounded-full bg-background shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
