/** SDK storage only: an atomic pointer publishes encrypted, bounded chunks. */
export interface SecureValues {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
interface Pointer { generation: string; count: number }

export function secureChunks(value: string, maxBytes = 1500): string[] {
  const chunks: string[] = [];
  let current = "", bytes = 0;
  for (const char of value) {
    const point = char.codePointAt(0)!;
    const size = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + size > maxBytes) { chunks.push(current); current = ""; bytes = 0; }
    current += char; bytes += size;
  }
  if (current || !chunks.length) chunks.push(current);
  return chunks;
}

export function createSecureSessionStorage(values: SecureValues, namespace: string, generation: () => string) {
  const prefix = namespace.replace(/[^a-zA-Z0-9._-]/g, "_");
  const base = (key: string) => `${prefix}.${encodeURIComponent(key).replace(/%/g, "_")}`;
  let queue = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const task = queue.then(work);
    queue = task.then(() => undefined, () => undefined);
    return task;
  };
  const pointer = async (key: string): Promise<Pointer | null> => {
    const raw = await values.getItem(base(key));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Pointer;
    if (!/^[a-zA-Z0-9_-]+$/.test(parsed.generation) || !Number.isInteger(parsed.count) || parsed.count < 1 || parsed.count > 512) throw new Error("Secure session storage metadata is invalid");
    return parsed;
  };
  const removeChunks = async (key: string, old: Pointer | null) => {
    if (!old) return;
    await Promise.all(Array.from({ length: old.count }, (_, i) => values.removeItem(`${base(key)}.${old.generation}.${i}`)));
  };
  return {
    getItem: (key: string) => serialized(async () => {
      const current = await pointer(key);
      if (!current) return null;
      const chunks = await Promise.all(Array.from({ length: current.count }, (_, i) => values.getItem(`${base(key)}.${current.generation}.${i}`)));
      if (chunks.some((chunk) => chunk === null)) throw new Error("Secure session storage is incomplete; retry unlocking this device");
      return chunks.join("");
    }),
    setItem: (key: string, value: string) => serialized(async () => {
      const old = await pointer(key), id = generation(), chunks = secureChunks(value);
      if (!/^[a-zA-Z0-9_-]+$/.test(id) || chunks.length > 512) throw new Error("Secure session storage value is too large");
      const next = { generation: id, count: chunks.length };
      try {
        for (let i = 0; i < chunks.length; i++) await values.setItem(`${base(key)}.${id}.${i}`, chunks[i]!);
        await values.setItem(base(key), JSON.stringify(next));
      } catch (error) {
        await removeChunks(key, next).catch(() => undefined);
        throw error;
      }
      // Once committed, a cleanup error must not turn a successful SDK save into failure.
      await removeChunks(key, old).catch(() => undefined);
    }),
    removeItem: (key: string) => serialized(async () => {
      const old = await pointer(key);
      await values.removeItem(base(key));
      await removeChunks(key, old);
    }),
  };
}
