/**
 * How a signed-in user is labelled in the popup — pure functions, no
 * `@clerk/chrome-extension` import, so they run (and are tested) in plain node.
 * The `HeaderIdentity` component is the thin Clerk wrapper over these.
 */

export interface IdentityInput {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

/** Mask an email for display: the first three chars of the local part, then
 * `**`, then the untouched `@domain`. A local part shorter than three chars
 * keeps whatever chars it has (`ab@x.com` → `ab**@x.com`). A malformed address
 * (no local part or no domain) yields "" so the header shows nothing rather
 * than a broken mask. */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  // at <= 0 covers "no @" and an empty local part; the last-char check covers an
  // empty domain — both are unmaskable, so degrade to nothing.
  if (at <= 0 || at === trimmed.length - 1) return "";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `${local.slice(0, 3)}**@${domain}`;
}

/** The label for a signed-in user: the full name when we have both parts,
 * otherwise a masked email, otherwise "" (nothing worth showing). */
export function displayIdentity({ firstName, lastName, email }: IdentityInput): string {
  const first = firstName?.trim();
  const last = lastName?.trim();
  if (first && last) return `${first} ${last}`;
  if (email) return maskEmail(email);
  return "";
}
