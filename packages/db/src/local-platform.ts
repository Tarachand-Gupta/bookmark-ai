import { existsSync, mkdirSync, rmSync } from "node:fs";

/**
 * Local/dev counterpart to `TursoPlatform` for `MULTI_TENANT=1` running
 * entirely on local sqlite files (no Turso Platform API, no network calls).
 * Structurally matches the `TenantPlatform` interface used by
 * `packages/engine/src/tenants.ts` (not imported here to avoid a package
 * cycle — engine depends on db). Each "database" is just a `<dir>/<name>.db`
 * file; `hostname` is returned as a `file:` URL so `toDbUrl()` in tenants.ts
 * uses it verbatim instead of prepending `libsql://`.
 */
export class LocalFilePlatform {
  constructor(private readonly dir: string = "../../data/tenants") {}

  /** Create (or adopt) a tenant DB file. `created` reflects whether the file existed yet. */
  async createDatabase(name: string): Promise<{ name: string; hostname: string; created: boolean }> {
    mkdirSync(this.dir, { recursive: true });
    const path = `${this.dir}/${name}.db`;
    const created = !existsSync(path);
    return { name, hostname: `file:${path}`, created };
  }

  /** Look up a tenant DB file. Always `created: false` — this never creates. */
  async getDatabase(name: string): Promise<{ name: string; hostname: string; created: boolean }> {
    const path = `${this.dir}/${name}.db`;
    return { name, hostname: `file:${path}`, created: false };
  }

  /** Delete a tenant DB file and its WAL/SHM sidecars. Tolerates already-missing files. */
  async deleteDatabase(name: string): Promise<void> {
    const path = `${this.dir}/${name}.db`;
    for (const p of [path, `${path}-wal`, `${path}-shm`]) {
      try {
        rmSync(p);
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
      }
    }
  }

  /** file: DBs need no auth token — always returns an empty (non-null) string. */
  async createToken(
    _dbName: string,
    _opts: { authorization: "full-access" | "read-only"; expiration?: string },
  ): Promise<string> {
    return "";
  }
}
