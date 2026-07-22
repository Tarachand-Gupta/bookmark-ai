import { useState } from "react";
import { maskAccountEmail } from "@/lib/identity";

/**
 * The signed-in user's email as the header subtext, masked (`tar****com`) by
 * default. Hovering the row surfaces a ghost eye button; clicking it reveals the
 * full address (icon flips to eye-off). State is plain `useState` — the popup
 * unmounts on close, so it re-hides on its own. The `title` (a hover tooltip)
 * is attached ONLY while revealed, so the masked line can't leak the address.
 */
export function MaskedEmail({ email }: { email: string }) {
  const [revealed, setRevealed] = useState(false);
  const masked = maskAccountEmail(email);

  return (
    <div className="group flex items-center gap-1">
      <span
        className="truncate text-[11px] leading-tight text-muted-foreground"
        title={revealed ? email : undefined}
      >
        {revealed ? email : masked}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        aria-label={revealed ? "Hide email" : "Show email"}
        aria-pressed={revealed}
        // Hidden until the row is hovered (or the button focused) — the
        // opacity-0/group-hover idiom keeps the header clean at rest.
        className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
      >
        {revealed ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
      aria-hidden="true"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
