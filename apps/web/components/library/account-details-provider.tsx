"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { AccountResponse, UserSettings } from "@bookmark-ai/types";
import { useAuth } from "@/lib/auth";
import { resetLiveBaseCache, type MeResponse } from "@/lib/api";
import { onExplicitSignOut } from "@/lib/account-private-state";
import { settingsResourceCache, type SettingsResources } from "@/lib/settings-resource-cache";

type Details = {
  accountId: string | null;
  me: MeResponse | null;
  account: AccountResponse | null;
  settings: UserSettings | null;
  errors: Partial<Record<"me" | "account" | "settings", string>>;
  refreshing: boolean;
};
const Context = createContext<(Details & { refresh: () => void; rememberSettings: (settings: UserSettings) => void }) | null>(null);

/** Also works outside AccountDetailsProvider (onboarding/chat). Components share
 * the same reads, but retain their own unsaved drafts and show-once credentials. */
export function useSettingsResource<K extends keyof SettingsResources>(key: K, enabled = true) {
  const { userId, isLoaded } = useAuth();
  const scopeVersion = useSyncExternalStore(settingsResourceCache.subscribe, settingsResourceCache.scopeVersion, () => 0);
  const snapshot = useSyncExternalStore(
    settingsResourceCache.subscribe,
    () => settingsResourceCache.snapshot(userId, key),
    () => settingsResourceCache.snapshot(null, key),
  );
  useEffect(() => {
    if (!isLoaded) return;
    settingsResourceCache.setAccount(userId);
    const unsubscribe = userId ? onExplicitSignOut(userId, () => {
      settingsResourceCache.signOut(userId);
      resetLiveBaseCache();
    }) : () => {};
    if (userId && enabled) void settingsResourceCache.read(userId, key);
    return unsubscribe;
  }, [userId, isLoaded, key, enabled]);
  const isCurrent = useMemo(() => settingsResourceCache.guard(userId), [userId, scopeVersion]);
  const refresh = useCallback(() => userId && isCurrent() ? settingsResourceCache.read(userId, key, true) : Promise.resolve(undefined), [userId, key, isCurrent]);
  const invalidate = useCallback(() => userId && isCurrent() ? settingsResourceCache.invalidate(userId, key) : undefined, [userId, key, isCurrent]);
  const remember = useCallback((data: SettingsResources[K]) => {
    if (userId && isCurrent()) settingsResourceCache.remember(userId, key, data);
  }, [userId, key, isCurrent]);
  const update = (updater: (previous: SettingsResources[K] | undefined) => SettingsResources[K] | undefined) => {
    if (!userId || !isCurrent()) return;
    const next = updater(settingsResourceCache.snapshot(userId, key).data);
    if (next !== undefined) settingsResourceCache.remember(userId, key, next);
  };
  return {
    ...snapshot, accountId: userId, active: settingsResourceCache.isActive(userId),
    loading: snapshot.data === undefined && !snapshot.error,
    refresh, invalidate, remember, update, isCurrent,
  };
}

/** App-lifetime metadata preloads. Opening Settings reuses these pending/fresh
 * requests instead of aborting all three and starting over. */
export function AccountDetailsProvider({ children }: { children: React.ReactNode }) {
  const me = useSettingsResource("me");
  const account = useSettingsResource("account");
  const settings = useSettingsResource("settings");
  const { userId } = useAuth();
  useEffect(() => { resetLiveBaseCache(); }, [userId]);
  const refresh = useCallback(() => {
    if (userId) void Promise.all((["me", "account", "settings"] as const).map(key => settingsResourceCache.read(userId, key, true)));
  }, [userId]);
  const value = useMemo(() => ({
    accountId: userId,
    me: me.data ?? null, account: account.data ?? null, settings: settings.data ?? null,
    errors: { ...(me.error ? { me: me.error } : {}), ...(account.error ? { account: account.error } : {}), ...(settings.error ? { settings: settings.error } : {}) },
    refreshing: me.refreshing || account.refreshing || settings.refreshing,
    refresh,
    rememberSettings: settings.remember,
  }), [userId, me.data, me.error, me.refreshing, account.data, account.error, account.refreshing, settings.data, settings.error, settings.refreshing, refresh, settings.remember]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAccountDetails() { return useContext(Context); }
