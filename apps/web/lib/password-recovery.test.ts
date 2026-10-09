import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { passwordUpdateDestination, recoveryPage, recoveryReturnDestination } from './password-recovery';
function auth(user: unknown = { id: 'owned' }, assurance: unknown = { error: null, data: { currentLevel: 'aal1', nextLevel: 'aal1' } }) {
  return { getUser: vi.fn(async () => ({ data: { user }, error: null })), mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => assurance) } } as unknown as SupabaseClient['auth'];
}
describe('password recovery navigation and admission', () => {
  it('unwraps only a safe update-password callback and retains nested native continuation', () => {
    const native = '/auth/native/complete?flow=owned&browser_nonce=owned';
    expect(recoveryReturnDestination('/auth/update-password?next=' + encodeURIComponent(native))).toBe(native);
    expect(recoveryReturnDestination('/app')).toBeNull();
    expect(recoveryReturnDestination('https://evil.example/auth/update-password')).toBeNull();
    expect(recoveryReturnDestination('/auth/update-password?next=https://evil.example')).toBe('/app');
    expect(recoveryPage(native, true)).toBe('/auth/recovery?next=' + encodeURIComponent(native) + '&step=code');
  });
  it('requires provider-validated user even when a destination says reset password', async () => {
    await expect(passwordUpdateDestination(auth(null), '/auth/update-password')).rejects.toThrow('verified session');
  });
  it('fails closed on unavailable assurance and preserves MFA continuation', async () => {
    await expect(passwordUpdateDestination(auth({}, { error: null, data: null }), '/app')).rejects.toThrow();
    const next = '/auth/update-password?next=%2Fapp%2Fbookmarks';
    expect(await passwordUpdateDestination(auth({}, { error: null, data: { currentLevel: 'aal1', nextLevel: 'aal2' } }), next)).toBe('/auth/mfa?next=' + encodeURIComponent(next));
  });
  it('allows a provider-validated session after required MFA without assuming a recovery AMR', async () => {
    expect(await passwordUpdateDestination(auth(), '/app')).toBeNull();
    expect(await passwordUpdateDestination(auth({}, { error: null, data: { currentLevel: 'aal2', nextLevel: 'aal2' } }), '/app')).toBeNull();
  });
});
