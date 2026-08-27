import { useState } from "react";
import { maskAccountEmail } from "@/lib/identity";
import { IconButton } from "./ui/button";
import { EyeOffIcon } from "./ui/icons";

/**
 * The header's 22px identity chip: the account's initial in a muted circle.
 *
 * The masked-email reveal that used to occupy its own header line is FOLDED IN
 * here — the chip is a button whose tooltip carries the masked address
 * (`tar****com`) and whose click drops a small bubble with the full one. The
 * masked form is never a leak, and the full address is only ever rendered after
 * a deliberate click, exactly as the old `MaskedEmail` control worked. State is
 * plain `useState`, so closing the popup re-hides it.
 *
 * With no email on the account the chip is inert (a plain span titled with the
 * display name) rather than a button that reveals nothing.
 */
export function AccountAvatar({ name, email }: { name: string | null; email: string | null }) {
  const [revealed, setRevealed] = useState(false);
  const initial = (name ?? email ?? "?").trim().charAt(0).toUpperCase() || "?";

  const chip =
    "flex size-[22px] shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-semibold text-muted-foreground";

  if (!email) {
    return (
      <span className={chip} title={name ?? "Account"} aria-label={name ?? "Account"}>
        {initial}
      </span>
    );
  }

  return (
    <span className="relative flex items-center">
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        title={revealed ? email : maskAccountEmail(email)}
        aria-label={revealed ? "Hide account email" : "Show account email"}
        aria-expanded={revealed}
        className={`${chip} cursor-pointer transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      >
        {initial}
      </button>

      {revealed && (
        <span
          role="status"
          className="absolute right-0 top-full z-10 mt-1.5 flex max-w-[240px] items-center gap-1.5 rounded-md border border-border bg-popover px-2 py-1.5 text-[11px] leading-tight text-popover-foreground shadow-md"
        >
          <span className="min-w-0 break-all">{email}</span>
          <IconButton
            onClick={() => setRevealed(false)}
            aria-label="Hide account email"
            className="size-4"
          >
            <EyeOffIcon className="size-3" />
          </IconButton>
        </span>
      )}
    </span>
  );
}
