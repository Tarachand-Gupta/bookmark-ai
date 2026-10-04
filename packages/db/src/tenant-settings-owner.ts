import type { Db } from './client';

// Clients survive route bundles/HMR. The binding is server-only and contains
// no credential; it changes settings keys, never authentication subjects.
const state = globalThis as typeof globalThis & { __bmaiSettingsOwners?: WeakMap<object, { account: string; legacy: string }> };
const bindings = state.__bmaiSettingsOwners ??= new WeakMap();
export function bindTenantSettingsOwner(db: Db, account: string, legacy: string): void {
  if (!/^[a-f0-9-]{36}$/i.test(account) || !/^user_[A-Za-z0-9]+$/.test(legacy)) throw new Error('Invalid imported settings owner');
  const existing = bindings.get(db);
  if (existing && (existing.account !== account || existing.legacy !== legacy)) throw new Error('Conflicting imported settings owner');
  bindings.set(db, { account, legacy });
}
export function tenantSettingsOwner(db: Db, account: string): string {
  const binding = bindings.get(db);
  if (!binding) return account;
  if (account !== binding.account) throw new Error('Settings account does not own imported tenant');
  return binding.legacy;
}
