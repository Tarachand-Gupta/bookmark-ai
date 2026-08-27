import { cn } from "./cn";

/**
 * The live-tabs pill switch. A real `<button role="switch">`, never a checkbox,
 * and never nested inside another button — where it sits on a clickable tile it
 * is an absolutely positioned sibling, and it stops click propagation so flipping
 * the switch can't also trigger whatever is underneath it.
 *
 * On = emerald, off = the neutral `input` track. The emerald follows the repo's
 * light/dark pairing (600 in light — which is exactly the approved design's
 * `oklch(0.596 0.145 163.23)` — stepping to 500 in dark, where the deeper shade
 * loses contrast). The knob is white in both themes so it stays legible on
 * either track.
 */

const SIZES = {
  /** 26×16 — bento tile corner + per-window rows. */
  sm: { track: "h-4 w-[26px]", knob: "size-3", on: "translate-x-[10px]", off: "translate-x-0.5" },
  /** 30×18 — the expanded panel's header switch. */
  md: { track: "h-[18px] w-[30px]", knob: "size-3.5", on: "translate-x-3", off: "translate-x-0.5" },
} as const;

export interface SwitchPillProps {
  checked: boolean;
  onToggle: () => void;
  ariaLabel: string;
  disabled?: boolean;
  size?: keyof typeof SIZES;
  className?: string;
}

export function SwitchPill({
  checked,
  onToggle,
  ariaLabel,
  disabled = false,
  size = "sm",
  className,
}: SwitchPillProps) {
  const s = SIZES[size];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        // The switch often overlaps a clickable tile/row — never let the flip
        // bubble into that tile's own handler.
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        // NO positioning class here. `cn` is a plain join with no conflict
        // resolution, and Tailwind emits `.relative` AFTER `.absolute`, so a
        // `relative` in this base would silently beat a caller's `absolute` at
        // equal specificity (it did — the bento switch escaped its tile). A
        // switch has no business declaring its own position; the caller places it.
        "inline-flex shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        s.track,
        checked ? "bg-emerald-600 dark:bg-emerald-500" : "bg-input",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block rounded-full bg-white shadow-sm transition-transform",
          s.knob,
          checked ? s.on : s.off,
        )}
      />
    </button>
  );
}
