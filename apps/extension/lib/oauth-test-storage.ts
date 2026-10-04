// Test-only in-memory equivalent of the three storage operations OAuth uses.
export const values = new Map<string, unknown>();
export const storage = {
  defineItem<T>(key: string, options: { fallback: T }) {
    return {
      getValue: async (): Promise<T> => (values.has(key) ? values.get(key) : options.fallback) as T,
      setValue: async (value: T) => {
        values.set(key, value);
      },
      removeValue: async () => {
        values.delete(key);
      },
    };
  },
};
