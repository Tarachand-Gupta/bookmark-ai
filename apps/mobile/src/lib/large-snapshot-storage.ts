import type { SnapshotStorage } from "./snapshot-cache";
export interface SnapshotFiles {
  read(name: string): Promise<string>;
  write(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}
const MARKER = "bookmarkSnapshotFile";
function filePointer(value: string | null): string | null {
  if (!value) return null;
  try { const parsed = JSON.parse(value); return parsed[MARKER] === 1 && /^[a-zA-Z0-9_-]+$/.test(parsed.name) ? parsed.name : null; } catch { return null; }
}
/** Large selections/transcripts exceed Android's per-row SQLite limit. Keep
 * small snapshots in the existing store; publish larger durable files through
 * a small pointer only after their complete write has succeeded. */
export function createLargeSnapshotStorage(storage: SnapshotStorage, files: SnapshotFiles, newId: () => string, threshold = 128_000): SnapshotStorage {
  return {
    getAllKeys: () => storage.getAllKeys(),
    async getItem(key) {
      const raw = await storage.getItem(key), name = filePointer(raw);
      return name ? files.read(name).catch(() => null) : raw;
    },
    async setItem(key, value) {
      const previous = filePointer(await storage.getItem(key));
      const name = value.length > threshold ? newId() : null;
      try {
        if (name) await files.write(name, value);
        await storage.setItem(key, name ? JSON.stringify({ [MARKER]: 1, name }) : value);
      } catch (error) {
        if (name) await files.remove(name).catch(() => undefined);
        throw error;
      }
      if (previous) await files.remove(previous).catch(() => undefined);
    },
    async multiRemove(keys) {
      const names = await Promise.all(keys.map(async key => filePointer(await storage.getItem(key))));
      await storage.multiRemove(keys);
      await Promise.all(names.filter((name): name is string => !!name).map(name => files.remove(name)));
    },
  };
}
