import { cn } from "@/lib/utils";
import { mono } from "../primitives";
import { SAVED_PAGE, SESSION_TABS } from "./data";

/**
 * The extension popup, restaged.
 *
 * Mirrors `apps/extension/entrypoints/popup/App.tsx`: the "B" mark + wordmark
 * header, the SaveCard (favicon / title / url / primary action), the session
 * button, and the settings row. Labels are the product's real ones — someone
 * who installs the extension after watching this should recognise every string.
 *
 * Sizing note: this re-bases off the browser's type scale (`1.15em`) rather
 * than inheriting it. The toolbar wants to read like a real 450px-wide browser
 * chrome; the popup is the subject of two of the five beats and has to carry
 * legible copy at the same camera distance. One number decouples them.
 *
 * Within that base, everything is in `em` at roughly 0.8x the real popup's rem
 * values (the mock is ~80% of a 320px popup once the camera is pushed in). So
 * `text-sm` → `0.7em`, `h-9` → `1.8em`, and the proportions come out honest.
 *
 * The button's three states are stacked absolutely rather than swapped, so
 * `Save bookmark` → `Saving…` → `Saved` cross-fades with zero reflow.
 */
export function PopupMock() {
  return (
    <div
      data-demo="popup"
      style={{ willChange: "transform, opacity" }}
      className={cn(
        "absolute right-[3.5%] top-[21%] z-20 w-[56%] origin-top-right rounded-[0.6em] p-[0.8em] text-[1.15em] opacity-0",
        "border border-border/80 bg-card/95 text-card-foreground backdrop-blur-md",
        "shadow-[0_10px_30px_-6px_rgb(0_0_0/0.35)]",
        "dark:border-white/[0.14] dark:bg-[#161616]/95 dark:shadow-[0_16px_40px_-8px_rgb(0_0_0/0.9)]",
      )}
    >
      {/* Header — brand mark + wordmark. */}
      <div className="flex items-center gap-[0.4em]">
        <span className="flex size-[1em] items-center justify-center rounded-[0.2em] bg-primary text-[0.58em] font-bold leading-none text-primary-foreground">
          B
        </span>
        <span className="text-[0.7em] font-semibold tracking-tight">Bookmark AI</span>
      </div>

      {/* SaveCard — the page in the active tab, and the primary action. */}
      <div className="mt-[0.6em] rounded-[0.6em] border border-border/70 bg-background/60 p-[0.6em] dark:bg-white/[0.03]">
        <div className="flex items-center gap-[0.6em]">
          <span
            className={cn(
              mono,
              "flex size-[1.6em] shrink-0 items-center justify-center rounded-[0.3em] border border-border/70 bg-foreground/[0.07] text-[0.62em] font-semibold",
            )}
          >
            {SAVED_PAGE.mark}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.7em] font-medium leading-tight">{SAVED_PAGE.title}</p>
            {/* One slot, two states. Gemini's category takes the URL's place the
                moment the save resolves — which is what the real SavedResult
                does, and it keeps the chip from stealing width from the title
                for the 2.4s before it exists. */}
            <div className="relative h-[0.8em]">
              <span
                data-demo="popup-url"
                className={cn(
                  mono,
                  "absolute inset-0 truncate text-[0.58em] leading-tight text-muted-foreground",
                )}
              >
                {SAVED_PAGE.url}
              </span>
              <span
                data-demo="popup-chip"
                className="absolute inset-y-0 left-0 flex items-center opacity-0"
              >
                <span
                  className={cn(
                    mono,
                    "rounded-[0.25em] bg-primary px-[0.4em] py-[0.1em] text-[0.5em] font-medium leading-none text-primary-foreground",
                  )}
                >
                  {SAVED_PAGE.category}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div
          data-demo="save-btn"
          className="relative mt-[0.6em] h-[1.8em] w-full rounded-[0.4em] bg-primary text-[0.68em] font-medium text-primary-foreground shadow-sm"
        >
          <span data-demo="save-idle" className="absolute inset-0 flex items-center justify-center">
            Save bookmark
          </span>
          <span
            data-demo="save-busy"
            className="absolute inset-0 flex items-center justify-center gap-[0.4em] opacity-0"
          >
            <Spinner />
            Saving…
          </span>
          <span
            data-demo="save-done"
            className="absolute inset-0 flex items-center justify-center gap-[0.3em] opacity-0"
          >
            <CheckMark />
            Saved
          </span>
        </div>
      </div>

      {/* Secondary action — the whole window, in one snapshot. */}
      <div className="mt-[0.6em] flex h-[1.8em] w-full items-center justify-center rounded-[0.4em] border border-border/70 bg-secondary text-[0.62em] font-medium text-secondary-foreground">
        Save session &amp; close ({SESSION_TABS} tabs)
      </div>

      {/* Settings row + footer, flattened to the one line they read as. */}
      <div className="mt-[0.6em] flex items-center justify-between border-t border-border/60 pt-[0.5em]">
        <span className={cn(mono, "text-[0.55em] text-muted-foreground")}>bookmark-ai.cloud</span>
        <span className={cn(mono, "text-[0.55em] text-muted-foreground")}>Open website ↗</span>
      </div>
    </div>
  );
}

/** Ring with a gap; the timeline spins it while the save is in flight. */
function Spinner() {
  return (
    <svg data-demo="spinner" viewBox="0 0 16 16" className="size-[1em]" aria-hidden>
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="2"
      />
      <path
        d="M8 2 A6 6 0 0 1 14 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-[0.95em]" aria-hidden>
      <path
        d="M3.5 8.5 L6.5 11.5 L12.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
