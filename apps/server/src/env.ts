import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().default("file:./data/bookmarks.db"),
  /** Required for libsql:// (Turso) URLs; unused for local file: DBs. */
  DATABASE_AUTH_TOKEN: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Dependency-free .env loader — repo root first, then the app dir.
 * Values already present in the real environment always win; a missing
 * file is fine (the no-key heuristic setup needs no .env at all).
 */
function loadDotEnv(): void {
  for (const rel of ["../../.env", ".env"]) {
    let text: string;
    try {
      text = readFileSync(resolve(process.cwd(), rel), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (line.trimStart().startsWith("#")) continue;
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      const [, key, raw] = m ?? [];
      if (!key || raw === undefined) continue;
      const value = raw.replace(/^(["'])(.*)\1$/, "$2");
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

export function loadEnv(): Env {
  loadDotEnv();
  return envSchema.parse(process.env);
}
