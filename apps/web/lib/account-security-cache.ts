"use client";
import { getAccessToken, getBrowserSupabase } from "./auth";
import { onExplicitSignOut } from "./account-private-state";

export type AccountDevice = {
  id: string;
  displayName: string;
  clientType: string;
  browser: string | null;
  os: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  isCurrent: boolean;
};
export type AccountFactor = { id: string; friendly_name?: string; status: string };
type Resources = { devices: AccountDevice[]; factors: AccountFactor[] };
type Entry<T> = {
  value?: T;
  expiresAt: number;
  pending?: Promise<T>;
  dispose?: () => void;
  controller: AbortController;
};
const devices = new Map<string, Entry<AccountDevice[]>>();
const factors = new Map<string, Entry<AccountFactor[]>>();
const FRESH_MS = 30_000;
const TIMEOUT_MS = 10_000;

export function clearAccountSecurity(accountId?: string, resource?: keyof Resources) {
  const caches =
    resource === "devices" ? [devices] : resource === "factors" ? [factors] : [devices, factors];
  for (const cache of caches) {
    for (const [id, entry] of cache) {
      if (accountId && id !== accountId) continue;
      cache.delete(id);
      entry.controller.abort();
      entry.dispose?.();
    }
  }
}
export const invalidateAccountSecurity = clearAccountSecurity;

async function currentAuth(accountId: string) {
  const client = getBrowserSupabase();
  const { data, error } = await client.auth.getSession();
  if (error || data.session?.user.id !== accountId)
    throw new Error("Sign in to manage your account.");
  return client;
}

function read<K extends keyof Resources>(accountId: string, kind: K): Promise<Resources[K]> {
  if (!accountId) return Promise.reject(new Error("Sign in to manage your account."));
  const cache = (kind === "devices" ? devices : factors) as Map<string, Entry<Resources[K]>>;
  const cached = cache.get(accountId);
  if (cached?.pending) return cached.pending;
  if (cached?.value && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  cached?.dispose?.();
  const controller = new AbortController();
  const entry: Entry<Resources[K]> = { expiresAt: 0, controller };
  cache.set(accountId, entry);
  if (typeof window !== "undefined")
    entry.dispose = onExplicitSignOut(accountId, () => clearAccountSecurity(accountId));
  const operation = async (): Promise<Resources[K]> => {
    const client = await currentAuth(accountId);
    if (controller.signal.aborted) throw new Error("Account read cancelled.");
    let value: AccountDevice[] | AccountFactor[];
    if (kind === "devices") {
      const token = await getAccessToken();
      await currentAuth(accountId);
      if (!token || controller.signal.aborted) throw new Error("Sign in to manage your account.");
      const response = await fetch("/api/auth/sessions", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Devices could not be loaded. Try again.");
      const data = await response.json();
      if (!Array.isArray(data.sessions)) throw new Error("Devices could not be loaded. Try again.");
      value = data.sessions.map((device: AccountDevice) => ({
        id: device.id,
        displayName: device.displayName,
        clientType: device.clientType,
        browser: device.browser,
        os: device.os,
        createdAt: device.createdAt,
        lastActiveAt: device.lastActiveAt,
        isCurrent: device.isCurrent,
      }));
    } else {
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) throw new Error("Authenticators could not be loaded. Try again.");
      // Deliberately whitelist summary fields; never retain enrollment secrets.
      value = data.totp.map(({ id, friendly_name, status }) => ({ id, friendly_name, status }));
    }
    await currentAuth(accountId);
    if (cache.get(accountId) !== entry || controller.signal.aborted)
      throw new Error("Account read cancelled.");
    return value as Resources[K];
  };
  let timer: ReturnType<typeof setTimeout>;
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(new Error("Account settings could not be loaded. Try again.")),
      { once: true },
    );
    timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  });
  entry.pending = Promise.race([operation(), cancelled])
    .then((value) => {
      if (cache.get(accountId) !== entry || controller.signal.aborted)
        throw new Error("Account read cancelled.");
      entry.value = value;
      entry.expiresAt = Date.now() + FRESH_MS;
      return value;
    })
    .catch((error) => {
      if (cache.get(accountId) === entry) cache.delete(accountId);
      entry.dispose?.();
      throw error;
    })
    .finally(() => {
      clearTimeout(timer);
      entry.pending = undefined;
    });
  return entry.pending;
}
export const readAccountDevices = (accountId: string) => read(accountId, "devices");
export const readAccountFactors = (accountId: string) => read(accountId, "factors");
/** Safe to fire and forget on opening Settings; panes surface individual failures. */
export function preloadAccountSecurity(accountId: string): Promise<unknown> {
  return Promise.allSettled([readAccountDevices(accountId), readAccountFactors(accountId)]);
}
