import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Client;

/**
 * Create a libSQL client. File URLs get their parent directory created so a
 * fresh checkout boots without manual setup. Swap DATABASE_URL for a
 * `libsql://…` Turso URL later — nothing else changes.
 */
export function createDb(url: string, authToken?: string): Db {
  if (url.startsWith("file:")) {
    const path = url.slice("file:".length);
    mkdirSync(dirname(path), { recursive: true });
  }
  return createClient({ url, authToken });
}
