/**
 * Minimal fetch-based Turso Platform API client (no SDK dependency). Config is
 * explicit — packages never read process.env; the adapter passes credentials in.
 * Base: https://api.turso.tech/v1/organizations/{org}
 */

export interface PlatformConfig {
  /** Turso Platform API token (Bearer). */
  apiToken: string;
  /** Organization slug. */
  org: string;
  /** Group to create databases in (e.g. "default"). */
  group: string;
}

/** A Turso database as returned by create/get — enough to build a libsql URL. */
export interface PlatformDatabase {
  name: string;
  /** Host to connect to, e.g. "bmk-abc-org.aws-region.turso.io". */
  hostname: string;
  /**
   * True only when THIS call created the DB; false when it already existed (a
   * `createDatabase` 409, or any `getDatabase` read). Lets provisioning refuse
   * to adopt a DB it didn't create (hash-prefix collision guard).
   */
  created: boolean;
}

export interface CreateTokenOptions {
  authorization: "full-access" | "read-only";
  /** Optional Turso expiration string, e.g. "2w1d" or "never". */
  expiration?: string;
}

/** Thrown for non-tolerated Turso API failures. Carries status + body excerpt. */
export class TursoPlatformError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "TursoPlatformError";
    this.status = status;
    this.body = body;
  }
}

export class TursoPlatform {
  private readonly base: string;

  constructor(private readonly config: PlatformConfig) {
    this.base = `https://api.turso.tech/v1/organizations/${config.org}`;
  }

  /**
   * Create a database in the configured group. Idempotent: an existing DB (409)
   * resolves via getDatabase but is flagged `created: false` so the caller can
   * tell a fresh create from an adopted one.
   */
  async createDatabase(name: string): Promise<PlatformDatabase> {
    const res = await this.request("POST", "/databases", {
      name,
      group: this.config.group,
    });
    if (res.status === 409) return this.getDatabase(name);
    if (!res.ok) return this.fail(res, "createDatabase");
    return this.parseDatabase(await res.json(), true);
  }

  /** Fetch an existing database's metadata (name + hostname). `created: false`. */
  async getDatabase(name: string): Promise<PlatformDatabase> {
    const res = await this.request("GET", `/databases/${encodeURIComponent(name)}`);
    if (!res.ok) return this.fail(res, "getDatabase");
    return this.parseDatabase(await res.json(), false);
  }

  /** Delete a database. Tolerates 404 (already gone) so it stays idempotent. */
  async deleteDatabase(name: string): Promise<void> {
    const res = await this.request("DELETE", `/databases/${encodeURIComponent(name)}`);
    if (res.status === 404) return;
    if (!res.ok) return this.fail(res, "deleteDatabase");
  }

  /** Mint an auth token for a database. Returns the JWT. */
  async createToken(dbName: string, opts: CreateTokenOptions): Promise<string> {
    const params = new URLSearchParams({ authorization: opts.authorization });
    if (opts.expiration) params.set("expiration", opts.expiration);
    const res = await this.request(
      "POST",
      `/databases/${encodeURIComponent(dbName)}/auth/tokens?${params.toString()}`,
    );
    if (!res.ok) return this.fail(res, "createToken");
    const json = (await res.json()) as { jwt?: unknown };
    if (typeof json.jwt !== "string") {
      return this.fail(res, "createToken (missing jwt)");
    }
    return json.jwt;
  }

  private request(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.apiToken}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private parseDatabase(json: unknown, created: boolean): PlatformDatabase {
    const obj = (json ?? {}) as Record<string, unknown>;
    const db = (obj.database ?? obj) as Record<string, unknown>;
    const name = db.Name ?? db.name;
    const hostname = db.Hostname ?? db.hostname;
    if (typeof name !== "string" || typeof hostname !== "string") {
      throw new TursoPlatformError(
        "Turso database response missing Name/Hostname",
        200,
        JSON.stringify(json).slice(0, 500),
      );
    }
    return { name, hostname, created };
  }

  private async fail(res: Response, action: string): Promise<never> {
    let body = "";
    try {
      body = await res.text();
    } catch {
      body = "";
    }
    throw new TursoPlatformError(
      `Turso ${action} failed (${res.status})`,
      res.status,
      body.slice(0, 500),
    );
  }
}
