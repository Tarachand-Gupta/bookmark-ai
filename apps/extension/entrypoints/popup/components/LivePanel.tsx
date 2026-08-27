import { useState } from "react";
import type { LiveState } from "../use-live";
import { openDeviceSettings, openLiveView } from "../nav";
import { ErrorNote } from "./ErrorNote";
import { IconButton, TextLink } from "./ui/button";
import { ExternalLinkIcon, PencilIcon, RadioIcon } from "./ui/icons";
import { SwitchPill } from "./ui/switch-pill";

/**
 * The live tile expanded in place — everything the feature can be told, on one
 * card, with the rest of the popup collapsed to an icon strip below it.
 *
 * Four stacked sections separated by hairlines: the header (collapse + master
 * switch), one row per open window, the new-window policy hint, and the device
 * identity row (rename + a link into the live view). Every control is a real
 * button; the header's collapse target and its switch are siblings so nothing
 * nests.
 */
export function LivePanel({ live, webUrl }: { live: LiveState; webUrl: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function beginEdit() {
    setDraft(live.label);
    setEditing(true);
  }

  function commit() {
    // Hand the draft to `saveLabel` explicitly — the hook's `label` state hasn't
    // been updated yet, and reading it here would persist the OLD name.
    live.saveLabel(draft.trim() || live.label);
    setEditing(false);
  }

  const total = live.windows.length;

  return (
    <div className="flex flex-col gap-2">
      <section className="overflow-hidden rounded-lg border border-border">
        {/* Header — clicking the body collapses back to the bento; the switch is
            a sibling that flips publishing without collapsing. The switch is
            placed by FLEX (`ml-auto` + the row's `items-center`), the same way
            the per-window rows below do it — no absolute positioning, so there
            is no transform to cancel and nothing to drift off centre. */}
        <div className="flex items-center pr-3">
          <button
            type="button"
            onClick={() => live.setExpanded(false)}
            aria-expanded
            aria-label="Collapse live tabs"
            className="flex min-w-0 flex-1 items-center gap-2.5 p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <RadioIcon
              className={
                live.enabled
                  ? "size-[18px] text-emerald-600 dark:text-emerald-500"
                  : "size-[18px] text-muted-foreground"
              }
              strokeWidth={1.8}
            />
            <span className="flex min-w-0 flex-col gap-px">
              <span className="text-[13px] font-semibold">Live tabs</span>
              <span
                className={
                  live.enabled
                    ? "text-[11px] text-emerald-600 dark:text-emerald-500"
                    : "text-[11px] text-muted-foreground"
                }
              >
                {!live.enabled
                  ? "Off — your tabs stay on this device"
                  : live.scanned
                    ? `Sharing ${live.sharedCount} of ${total} window${total === 1 ? "" : "s"}`
                    : "On"}
              </span>
            </span>
          </button>
          <SwitchPill
            size="md"
            checked={live.enabled}
            disabled={live.busy}
            onToggle={live.toggle}
            ariaLabel="Share this browser's open tabs"
            className="ml-auto"
          />
        </div>

        {/* Per-window rows. Only meaningful while publishing is on — an off
            device has nothing to include or exclude. */}
        {live.enabled && live.windows.length > 0 && (
          <div className="flex flex-col border-t border-border px-3 py-1.5">
            {live.windows.map((win) => (
              <div key={win.id} className="flex items-center gap-2 py-[7px]">
                <span
                  className={
                    win.shared
                      ? "min-w-0 truncate text-xs font-medium"
                      : "min-w-0 truncate text-xs font-medium text-muted-foreground"
                  }
                >
                  {win.name}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {win.tabCount} tab{win.tabCount === 1 ? "" : "s"}
                </span>
                <SwitchPill
                  checked={win.shared}
                  disabled={win.busy}
                  onToggle={() => live.toggleWindow(win.id)}
                  ariaLabel={`Share ${win.name}`}
                  className="ml-auto"
                />
              </div>
            ))}
          </div>
        )}

        {/* One-line policy hint, shown only right after the user turns live ON in
            this popup. Wording follows the device's new-window policy; "settings"
            deep-links to Settings → Devices where the policy is changed. */}
        {live.showPolicyHint && live.enabled && (
          <p className="border-t border-border px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            {live.policyDefault
              ? "All future windows will have live sessions enabled by default. Change this behavior in "
              : "New windows won't join live sessions by default. Change this in "}
            <TextLink
              onClick={() => openDeviceSettings(webUrl)}
              className="text-[11px] underline underline-offset-2"
            >
              settings
            </TextLink>
            .
          </p>
        )}

        {/* Device identity: text with an inline edit affordance, not a permanent
            input. Save semantics are unchanged (persist, then force a push). */}
        <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
          {editing ? (
            <>
              <input
                type="text"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(false);
                }}
                placeholder="This device"
                spellCheck={false}
                aria-label="This device's name"
                className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <TextLink onClick={commit} className="shrink-0 text-muted-foreground">
                Save
              </TextLink>
            </>
          ) : (
            <>
              <span className="shrink-0 text-xs text-muted-foreground">Shown as</span>
              <span className="min-w-0 truncate text-xs font-medium">
                {live.label || "This device"}
              </span>
              <IconButton
                onClick={beginEdit}
                aria-label="Rename this device"
                title="Rename this device"
                className="size-[22px]"
              >
                <PencilIcon className="size-3" />
              </IconButton>
              {live.labelSaved && (
                <span className="shrink-0 text-[11px] text-emerald-600 dark:text-emerald-500">
                  Saved
                </span>
              )}
              <TextLink
                onClick={() => openLiveView(webUrl)}
                className="ml-auto shrink-0 text-foreground"
              >
                Open live view
                <ExternalLinkIcon className="size-3" />
              </TextLink>
            </>
          )}
        </div>
      </section>

      {live.error && <ErrorNote message={live.error} />}
    </div>
  );
}
