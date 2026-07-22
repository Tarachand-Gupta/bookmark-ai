/**
 * How a signed-in user is labelled in the popup — pure functions, no
 * `@clerk/chrome-extension` import, so they run (and are tested) in plain node.
 * The background computes the header name via `fullName`; the popup falls back
 * to the email when there is no name.
 */

export interface IdentityInput {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

export interface NameInput {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}

/** A display NAME for the header (no email fallback — the caller handles that):
 * the full name when either part is set, else the username, else null. Unlike
 * `displayIdentity`, a single name part is enough (a first-name-only account
 * still shows its first name rather than dropping to the email). */
export function fullName({ firstName, lastName, username }: NameInput): string | null {
  const parts = [firstName?.trim(), lastName?.trim()].filter((p): p is string => Boolean(p));
  if (parts.length > 0) return parts.join(" ");
  const user = username?.trim();
  return user ? user : null;
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

/** Mask an account email for the popup header subtext: the first three and last
 * three characters with `****` between, hiding everything in the middle (domain
 * included) — `tarachandragupta2784@gmail.com` → `tar****com`. An address of six
 * chars or fewer (where the two windows would cover the whole string) is shown
 * unmasked. The reveal control lives in the `MaskedEmail` component. */
export function maskAccountEmail(email: string): string {
  const trimmed = email.trim();
  if (trimmed.length <= 6) return trimmed;
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-3)}`;
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
