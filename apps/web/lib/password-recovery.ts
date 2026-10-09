import type { SupabaseClient } from '@supabase/supabase-js';
import { authDestinationFromSearch, safeAuthDestination } from './auth-policy';
import { nativeMfaDestination } from './native-auth-context';

/** Destination is navigation only. Supabase must validate the session separately. */
export function recoveryReturnDestination(next: string): string | null {
  const target = new URL(safeAuthDestination(next), 'https://bookmark.invalid');
  return target.pathname === '/auth/update-password'
    ? authDestinationFromSearch(target.search)
    : null;
}
export function recoveryPage(next: string, enterCode = false): string {
  return '/auth/recovery?next=' + encodeURIComponent(safeAuthDestination(next)) + (enterCode ? '&step=code' : '');
}
/** Recovery OTPs use the provider's `otp` AMR, also used for email sign-in.
 * Validate with the provider and enforce MFA; do not authorize from a URL or AMR label. */
export async function passwordUpdateDestination(auth: SupabaseClient['auth'], next: string): Promise<string | null> {
  const { data, error } = await auth.getUser();
  if (error || !data.user) throw new Error('A verified session is required.');
  return nativeMfaDestination(await auth.mfa.getAuthenticatorAssuranceLevel(), next);
}
