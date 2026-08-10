import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { DEFAULT_WEB_URL, getWebBaseUrl } from "@/lib/api";
import { getDeviceLabel, setDeviceLabel } from "@/lib/device-id";
import { liveEnabledItem } from "@/lib/live-storage";
import {
  requestLivePushNow,
  requestLiveWindowGet,
  requestLiveWindowSet,
  requestSetLiveEnabled,
} from "@/lib/messages";

/**
 * The authoritative on/off control for publishing this browser's open tabs
 * (§4.9). Default off (§5.1). Flipping the switch delegates to the background
 * (which holds the Clerk token): it mirrors the flag into storage.local AND
 * writes the account flag server-side. Copy avoids the banned words
 * "sync"/"live"/"real-time" (§3.4).
 *
 * ONE line by default. Everything else — the per-window "Share this window"
 * override, the explanatory copy, the device rename field, the link to the live
 * view — is behind the chevron, because two stacked switches made a secondary,
 * set-once feature compete with the save actions above it. Expansion is
 * per-popup-open state, NOT persisted: nothing else in the popup persists UI
 * state, and a collapsed default is the whole point.
 */
export function LiveTabsToggle() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [label, setLabel] = useState("");
  const [labelSaved, setLabelSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webUrl, setWebUrl] = useState(DEFAULT_WEB_URL);
  // The popup's own window (the background can't resolve it) and whether it is
  // currently shared. Default shared: a window is only ever hidden by an explicit
  // opt-out, so "unknown yet" reads as included.
  const [windowId, setWindowId] = useState<number | null>(null);
  const [windowShared, setWindowShared] = useState(true);
  const [windowBusy, setWindowBusy] = useState(false);
  // This device's new-window policy (mirrored from the server) and whether to show
  // the one-line hint under the main toggle. The hint appears only when the user
  // flips live ON in THIS interaction (not on every open); its wording depends on
  // the policy default.
  const [policyDefault, setPolicyDefault] = useState(true);
  const [showPolicyHint, setShowPolicyHint] = useState(false);

  useEffect(() => {
    void liveEnabledItem.getValue().then(setEnabled);
    void getDeviceLabel().then(setLabel);
    void getWebBaseUrl().then(setWebUrl);
    void browser.windows.getCurrent().then((win) => {
      if (typeof win.id !== "number") return;
      setWindowId(win.id);
      void requestLiveWindowGet(win.id).then((r) => {
        setWindowShared(r.shared);
        setPolicyDefault(r.policyDefault);
      });
    });
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
      // Surface the "future windows…" hint only when the user just turned live ON
      // and it stuck; turning off (or a failed turn-on) hides it.
      setShowPolicyHint(next && result.enabled);
      if (!result.ok) {
        setError(
          next
            ? "Couldn't turn this on — make sure you're signed in, then try again."
            : "Turned off here, but the server couldn't be reached to confirm.",
        );
      }
    } catch {
      setEnabled(!next); // background unreachable — revert the optimistic flip
      setShowPolicyHint(false);
      setError("Couldn't reach the extension background. Try reopening the popup.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleWindow() {
    if (windowBusy || windowId === null) return;
    const next = !windowShared;
    setWindowBusy(true);
    setWindowShared(next); // optimistic; corrected by the settled result
    try {
      const result = await requestLiveWindowSet(windowId, next);
      setWindowShared(result.shared);
    } finally {
      setWindowBusy(false);
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

  // Deep-link into Settings → Live sessions, where the per-device "Enable live
  // session on any new window" policy lives (the idiomatic ?settings=<section>
  // hook the web app already handles).
  function openLiveSettings() {
    void browser.tabs.create({ url: `${webUrl}/app?settings=devices` });
    window.close();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="rounded-lg border bg-muted/30">
        {/* Collapsed row: clicking anywhere but the switch expands the card. This
            is the ONLY thing the block shows by default — one switch, one line. */}
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
          className="flex cursor-pointer items-center gap-2.5 px-3 py-2"
        >
          <Switch checked={enabled} disabled={busy} onToggle={() => void toggle()} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium leading-tight">
              Share window as live session
            </span>
            {/* The per-window switch now lives inside the expander, so a window
                the user has opted OUT of would otherwise look identical to a
                shared one. Shown only in that non-default case. */}
            {enabled && !expanded && !windowShared && (
              <span className="truncate text-[10px] leading-tight text-muted-foreground">
                This window isn&rsquo;t shared
              </span>
            )}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        {/* One-line policy hint, shown only right after the user turns live ON in
            this popup. Wording follows the device's new-window policy; "settings"
            deep-links to Settings → Live sessions where the policy is changed. */}
        {showPolicyHint && enabled && (
          <p className="border-t px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            {policyDefault
              ? "All future windows will have live sessions enabled by default. Change this behavior in "
              : "New windows won't join live sessions by default. Change this in "}
            <button
              type="button"
              onClick={openLiveSettings}
              className="font-medium underline underline-offset-2 transition-colors hover:text-foreground"
            >
              settings
            </button>
            .
          </p>
        )}

        {expanded && (
          <div className="flex flex-col gap-2 border-t px-3 pb-3 pt-2">
            {/* Subordinate per-window control — BEHIND the expander (it used to
                sit stacked under the main switch, where two toggles read as two
                equally important decisions). Only meaningful once publishing is
                on. The switch reflects this window's resolved decision
                (override ?? policy): off drops the current window from pushes
                (removed from the mirror immediately, since pushes are
                full-replace), on shares it. */}
            {enabled && windowId !== null && (
              <div className="flex items-center gap-2.5">
                <Switch
                  checked={windowShared}
                  disabled={windowBusy}
                  onToggle={() => void toggleWindow()}
                  ariaLabel="Share this window"
                />
                <span className="flex-1 text-xs font-medium leading-tight text-muted-foreground">
                  Share this window
                </span>
              </div>
            )}

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
  ariaLabel = "Share window as live session",
}: {
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
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
