import {
  getAppReleases, getAccount, getLive, getMe, getObservability, getSettings, listMcpTokens, listSkills,
} from "./api";

export type ResourceSnapshot<T> = {
  data: T | undefined;
  error: string | null;
  refreshing: boolean;
  updatedAt: number;
};
const EMPTY: ResourceSnapshot<never> = Object.freeze({ data: undefined, error: null, refreshing: false, updatedAt: 0 });
type Reader<T> = (accountId: string, signal: AbortSignal) => Promise<T>;
type Entry<T> = {
  snapshot: ResourceSnapshot<T>;
  pending?: Promise<T | undefined>;
  cancel?: () => void;
};

/** One identity at a time, memory only. Every read settles, even if a transport
 * ignores abort; discarded requests and pre-mutation reads cannot publish late. */
export class SettingsResourceCache<S extends object> {
  private accountId: string | null = null;
  private blocked = false;
  private generation = 0;
  private entries = new Map<keyof S, Entry<S[keyof S]>>();
  private listeners = new Set<() => void>();

  constructor(
    private readers: { [K in keyof S]: Reader<S[K]> },
    private options = { freshnessMs: 60_000, timeoutMs: 12_000 },
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  scopeVersion = () => this.generation;
  private emit() { this.listeners.forEach(listener => listener()); }
  private discard() {
    this.generation++;
    for (const entry of this.entries.values()) entry.cancel?.();
    this.entries.clear();
  }
  setAccount(accountId: string | null) {
    if (this.accountId === accountId) return;
    this.discard();
    this.accountId = accountId;
    this.blocked = false;
    this.emit();
  }
  signOut(accountId: string) {
    if (this.accountId !== accountId || this.blocked) return;
    this.discard();
    this.blocked = true;
    this.emit();
  }
  isActive(accountId: string | null) {
    return !!accountId && accountId === this.accountId && !this.blocked;
  }
  /** Capture before an async mutation; rejects a late save after sign-out or A→B→A. */
  guard(accountId: string | null) {
    const generation = this.generation;
    return () => this.isActive(accountId) && this.generation === generation;
  }
  snapshot<K extends keyof S>(accountId: string | null, key: K): ResourceSnapshot<S[K]> {
    if (!this.isActive(accountId)) return EMPTY;
    return (this.entries.get(key)?.snapshot as ResourceSnapshot<S[K]>) ?? EMPTY;
  }
  read<K extends keyof S>(accountId: string, key: K, force = false): Promise<S[K] | undefined> {
    if (!this.isActive(accountId)) return Promise.resolve(undefined);
    const old = this.entries.get(key) as Entry<S[K]> | undefined;
    if (old?.pending) return old.pending;
    if (!force && old?.snapshot.data !== undefined && Date.now() - old.snapshot.updatedAt < this.options.freshnessMs) {
      return Promise.resolve(old.snapshot.data);
    }
    const controller = new AbortController();
    const entry: Entry<S[K]> = { snapshot: { ...(old?.snapshot ?? EMPTY), error: null, refreshing: true } };
    this.entries.set(key, entry as Entry<S[keyof S]>);
    const current = () => this.isActive(accountId) && this.entries.get(key) === entry;
    let finish!: (value: S[K] | undefined) => void;
    entry.pending = new Promise(resolve => { finish = resolve; });
    const pending = entry.pending;
    let settled = false;
    const settle = (data: S[K] | undefined, error: string | null, publish: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      entry.pending = undefined;
      entry.cancel = undefined;
      if (publish && current()) {
        entry.snapshot = {
          data: error ? entry.snapshot.data : data,
          error, refreshing: false,
          updatedAt: error ? entry.snapshot.updatedAt : Date.now(),
        };
        this.emit();
      }
      finish(error || !publish ? undefined : data);
    };
    const timer = setTimeout(() => {
      settle(undefined, "This request took too long. Please retry.", true);
      controller.abort();
    }, this.options.timeoutMs);
    entry.cancel = () => { settle(undefined, null, false); controller.abort(); };
    this.emit();
    try {
      this.readers[key](accountId, controller.signal).then(
        data => settle(data, null, true),
        error => settle(undefined, error instanceof Error ? error.message : "Couldn’t load this setting.", true),
      );
    } catch (error) {
      settle(undefined, error instanceof Error ? error.message : "Couldn’t load this setting.", true);
    }
    return pending;
  }
  prefetch(accountId: string, keys: (keyof S)[]) {
    return Promise.all(keys.map(key => this.read(accountId, key)));
  }
  remember<K extends keyof S>(accountId: string, key: K, data: S[K]) {
    if (!this.isActive(accountId)) return;
    this.entries.get(key)?.cancel?.();
    this.entries.set(key, { snapshot: { data, error: null, refreshing: false, updatedAt: Date.now() } });
    this.emit();
  }
  /** Successful edits invalidate the old in-flight read as well as its freshness. */
  invalidate<K extends keyof S>(accountId: string, key: K) {
    if (!this.isActive(accountId)) return;
    const old = this.entries.get(key);
    old?.cancel?.();
    this.entries.set(key, { snapshot: { ...(old?.snapshot ?? EMPTY), refreshing: false, updatedAt: 0 } });
    this.emit();
    return this.read(accountId, key, true);
  }
}

export type SettingsResources = {
  me: Awaited<ReturnType<typeof getMe>>;
  account: Awaited<ReturnType<typeof getAccount>>;
  settings: Awaited<ReturnType<typeof getSettings>>["settings"];
  tokens: Awaited<ReturnType<typeof listMcpTokens>>["tokens"];
  devices: Awaited<ReturnType<typeof getLive>>;
  skills: Awaited<ReturnType<typeof listSkills>>["skills"];
  observability: Awaited<ReturnType<typeof getObservability>>;
  releases: Awaited<ReturnType<typeof getAppReleases>>["releases"];
};
export const settingsResourceCache: SettingsResourceCache<SettingsResources> = new SettingsResourceCache<SettingsResources>({
  me: async (id, signal) => {
    const me = await getMe(signal, id);
    // Browser caches are scoped to the provider session, not the canonical
    // Bookmark AI account retained during the Clerk-to-Supabase migration.
    const sessionUserId = me.providerUserId ?? me.accountId;
    if (sessionUserId && sessionUserId !== id) throw Error("The account changed. Please try again.");
    return me;
  },
  account: (id, signal) => getAccount(signal, id, true),
  settings: async (id, signal) => (await getSettings(signal, id)).settings,
  // Token list is metadata only. A minted secret must never enter this cache.
  tokens: async (id, signal) => (await listMcpTokens(signal, id)).tokens,
  devices: (id, signal) => getLive(signal, id, settingsResourceCache.read(id, "settings").then(settings => {
    if (!settings) throw Error("Load settings before retrying live sessions.");
    return { settings };
  })),
  skills: async (id, signal) => (await listSkills(signal, id)).skills,
  observability: (id, signal) => getObservability(signal, id),
  releases: async (id, signal) => (await getAppReleases(signal, id)).releases,
});

export function preloadSettingsResources(accountId: string) {
  return settingsResourceCache.prefetch(accountId, ["me", "account", "settings", "tokens", "devices", "skills", "observability"]);
}
