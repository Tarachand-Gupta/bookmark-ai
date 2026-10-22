import type { ReactNode } from "react";

/**
 * The popup's one frame: a 360px column with 14px padding and a 12px rhythm.
 *
 * The width is settled in ONE place — `assets/tailwind.css` sets `body { width:
 * 360px }` — so this shell is `w-full` and nothing carries a `min-w-*` of its
 * own. (The old code fought itself: a 360px body against `min-w-[20rem]` = 320px
 * on four separate roots.)
 */
export function PopupShell({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-col gap-3 p-3.5">{children}</div>;
}
