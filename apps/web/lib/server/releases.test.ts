import { createClient } from "@libsql/client";
import { NextRequest, NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteAppRelease,
  getAppRelease,
  listAppReleases,
  MASTER_MIGRATIONS,
  runMigrations,
  upsertAppRelease,
  type AppReleaseRow,
  type Db,
} from "@bookmark-ai/db";
import {
  appReleasesResponseSchema,
  compareVersions,
  RELEASE_MIN_VERSION_MESSAGE,
  RELEASE_URL_MESSAGE,
  RELEASE_VERSION_MESSAGE,
  updateState,
  upsertAppReleaseSchema,
  type AppRelease,
} from "@bookmark-ai/types";

/**
 * App releases end to end: the pure version helpers every native client ships,
 * the upsert schema, the master-DB queries against a REAL in-memory libSQL DB
 * running the actual MASTER_MIGRATIONS (so v5's DDL is exercised), and the two
 * route handlers with the admin gate and master context mocked so the same
 * in-memory DB sits behind them.
 */

let db: Db;
/** What the mocked getMasterContext() returns — null models "no master DB configured". */
let masterCtx: { db: Db; ready: Promise<void> } | null = null;
/** What the mocked gateAdmin() returns — flipped per test. */
let adminGate: { ok: true } | { response: NextResponse } = { ok: true };

vi.mock("@/lib/server/context", () => ({
  getMasterContext: () => masterCtx,
}));
vi.mock("@/lib/server/admin-gate", () => ({
  gateAdmin: async () => adminGate,
}));

const publicRoute = await import("@/app/api/app/releases/route");
const adminRoute = await import("@/app/api/admin/releases/[platform]/route");

beforeAll(async () => {
  db = createClient({ url: ":memory:" }) as unknown as Db;
  await runMigrations(db, MASTER_MIGRATIONS);
});
afterAll(() => {
  (db as unknown as { close(): void }).close();
});
beforeEach(async () => {
  masterCtx = { db, ready: Promise.resolve() };
  adminGate = { ok: true };
  await db.execute("DELETE FROM app_releases");
});

const MACOS_URL = "https://github.com/Tarachand-Gupta/bookmark-ai/releases";

function putRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/releases/macos", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const params = (platform: string) => ({ params: Promise.resolve({ platform }) });
const getRequest = () => new NextRequest("http://localhost/api/app/releases");

describe("compareVersions", () => {
  it("compares numerically, never lexically", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
  });

  it("treats missing components as zero and tolerates a leading v", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3.1", "1.2.3")).toBe(1);
  });

  it("breaks a version tie with the build only when BOTH sides have one", () => {
    expect(compareVersions({ version: "1.0.0", build: "2" }, { version: "1.0.0", build: "1" })).toBe(1);
    expect(compareVersions({ version: "1.0.0", build: "10" }, { version: "1.0.0", build: "9" })).toBe(1);
    expect(compareVersions({ version: "1.0.0", build: "1.0.3" }, { version: "1.0.0", build: "1.0.2" })).toBe(1);
    expect(compareVersions({ version: "1.0.0", build: "2" }, { version: "1.0.0", build: "2" })).toBe(0);
    expect(compareVersions({ version: "1.0.0", build: "5" }, { version: "1.0.0" })).toBe(0);
    expect(compareVersions({ version: "1.0.0", build: null }, { version: "1.0.0", build: "5" })).toBe(0);
    // Version always outranks build.
    expect(compareVersions({ version: "1.0.1", build: "1" }, { version: "1.0.0", build: "99" })).toBe(1);
  });
});

describe("updateState", () => {
  const release = { version: "0.2.0", build: "2", minSupportedVersion: "0.1.5" };

  it("is 'current' with no record, the same version, or a newer client", () => {
    expect(updateState({ version: "0.1.0", build: "1" }, null)).toBe("current");
    expect(updateState({ version: "0.1.0", build: "1" }, undefined)).toBe("current");
    expect(updateState({ version: "0.2.0", build: "2" }, release)).toBe("current");
    expect(updateState({ version: "0.3.0", build: "1" }, release)).toBe("current");
    // Same version, build unknown on the client → not an update.
    expect(updateState({ version: "0.2.0" }, release)).toBe("current");
  });

  it("is 'update-available' for an older version or an older build of the same version", () => {
    expect(updateState({ version: "0.1.9", build: "1" }, release)).toBe("update-available");
    expect(updateState({ version: "0.2.0", build: "1" }, release)).toBe("update-available");
    expect(updateState({ version: "0.1.9" }, { ...release, minSupportedVersion: null })).toBe("update-available");
  });

  it("is 'unsupported' below minSupportedVersion (compared by version only)", () => {
    expect(updateState({ version: "0.1.0", build: "1" }, release)).toBe("unsupported");
    expect(updateState({ version: "0.1.4", build: "999" }, release)).toBe("unsupported");
    expect(updateState({ version: "0.1.5", build: "1" }, release)).toBe("update-available");
  });
});

describe("upsertAppReleaseSchema", () => {
  const valid = { version: "0.2.0", build: "2", downloadUrl: MACOS_URL };

  it("accepts the minimal body and nulls the optional fields", () => {
    expect(upsertAppReleaseSchema.parse({ version: "0.2.0", downloadUrl: MACOS_URL })).toEqual({
      version: "0.2.0",
      build: null,
      minSupportedVersion: null,
      downloadUrl: MACOS_URL,
      releaseNotes: null,
    });
  });

  it("treats empty strings as unset (the admin form sends what it shows)", () => {
    const r = upsertAppReleaseSchema.parse({
      ...valid,
      build: "",
      minSupportedVersion: "  ",
      releaseNotes: "",
    });
    expect(r.build).toBeNull();
    expect(r.minSupportedVersion).toBeNull();
    expect(r.releaseNotes).toBeNull();
  });

  it("trims and keeps the optional fields when given", () => {
    const r = upsertAppReleaseSchema.parse({
      ...valid,
      build: " 42 ",
      minSupportedVersion: "0.1.0",
      releaseNotes: "  Fixes the sidebar.  ",
      publishedAt: "2026-09-07T10:00:00.000Z",
    });
    expect(r.build).toBe("42");
    expect(r.minSupportedVersion).toBe("0.1.0");
    expect(r.releaseNotes).toBe("Fixes the sidebar.");
    expect(r.publishedAt).toBe("2026-09-07T10:00:00.000Z");
  });

  it("rejects non-semver versions, non-numeric builds, non-https URLs, oversized notes", () => {
    const fail = (body: unknown) => upsertAppReleaseSchema.safeParse(body);
    expect(fail({ ...valid, version: "1.2" }).error?.issues[0]?.message).toBe(RELEASE_VERSION_MESSAGE);
    expect(fail({ ...valid, version: "v1.2.3" }).success).toBe(false);
    expect(fail({ ...valid, version: "1.2.3-beta" }).success).toBe(false);
    expect(fail({ ...valid, build: "2b" }).success).toBe(false);
    expect(fail({ ...valid, downloadUrl: "http://example.com/dl" }).error?.issues[0]?.message).toBe(RELEASE_URL_MESSAGE);
    expect(fail({ ...valid, downloadUrl: "not a url" }).success).toBe(false);
    expect(fail({ ...valid, releaseNotes: "x".repeat(2_001) }).success).toBe(false);
    expect(fail({ ...valid, publishedAt: "yesterday" }).success).toBe(false);
    expect(fail({ downloadUrl: MACOS_URL }).success).toBe(false);
  });

  it("rejects a minSupportedVersion newer than the version itself", () => {
    const r = upsertAppReleaseSchema.safeParse({ ...valid, minSupportedVersion: "0.3.0" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(RELEASE_MIN_VERSION_MESSAGE);
    expect(upsertAppReleaseSchema.safeParse({ ...valid, minSupportedVersion: "0.2.0" }).success).toBe(true);
  });
});

describe("app_releases queries (master migration v5)", () => {
  const row: AppReleaseRow = {
    platform: "macos",
    version: "0.2.0",
    build: "2",
    minSupportedVersion: null,
    downloadUrl: MACOS_URL,
    releaseNotes: null,
    publishedAt: "2026-09-07T10:00:00.000Z",
    updatedAt: "2026-09-07T10:00:00.000Z",
  };

  it("applied v5 (the table exists and starts empty)", async () => {
    const versions = (await db.execute("SELECT version FROM schema_migrations ORDER BY version")).rows.map((r) =>
      Number(r.version),
    );
    expect(versions).toContain(5);
    expect(await listAppReleases(db)).toEqual([]);
    expect(await getAppRelease(db, "macos")).toBeNull();
  });

  it("round-trips a row, replaces it on conflict, lists platform-sorted, deletes", async () => {
    await upsertAppRelease(db, row);
    expect(await getAppRelease(db, "macos")).toEqual(row);

    await upsertAppRelease(db, { ...row, version: "0.3.0", build: null, releaseNotes: "Notes" });
    expect(await getAppRelease(db, "macos")).toEqual({ ...row, version: "0.3.0", build: null, releaseNotes: "Notes" });

    await upsertAppRelease(db, { ...row, platform: "ios", version: "1.1.0" });
    await upsertAppRelease(db, { ...row, platform: "android", version: "1.0.1" });
    expect((await listAppReleases(db)).map((r) => r.platform)).toEqual(["android", "ios", "macos"]);

    expect(await deleteAppRelease(db, "ios")).toBe(true);
    expect(await deleteAppRelease(db, "ios")).toBe(false);
    expect((await listAppReleases(db)).map((r) => r.platform)).toEqual(["android", "macos"]);
  });
});

describe("GET /api/app/releases (public)", () => {
  it("returns {releases:{}} with the public cache header when nothing is published", async () => {
    const res = await publicRoute.GET(getRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual({ releases: {} });
  });

  it("returns {releases:{}} without a master DB (single-tenant / self-host)", async () => {
    masterCtx = null;
    const res = await publicRoute.GET(getRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ releases: {} });
  });

  it("returns {releases:{}} when the master read fails, never a 500", async () => {
    const broken = { execute: async () => { throw new Error("boom"); } } as unknown as Db;
    masterCtx = { db: broken, ready: Promise.resolve() };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await publicRoute.GET(getRequest());
    warn.mockRestore();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ releases: {} });
  });
});

describe("PUT/DELETE /api/admin/releases/:platform", () => {
  const body = { version: "0.2.0", build: "2", downloadUrl: MACOS_URL };

  it("is refused by the admin gate (the gate's response passes through untouched)", async () => {
    adminGate = { response: NextResponse.json({ error: "nope", code: "forbidden" }, { status: 403 }) };
    const put = await adminRoute.PUT(putRequest(body), params("macos"));
    expect(put.status).toBe(403);
    expect(await put.json()).toEqual({ error: "nope", code: "forbidden" });
    const del = await adminRoute.DELETE(putRequest(null), params("macos"));
    expect(del.status).toBe(403);
    expect(await getAppRelease(db, "macos")).toBeNull();
  });

  it("400s an unknown platform and an invalid body with a readable message", async () => {
    const platform = await adminRoute.PUT(putRequest(body), params("windows"));
    expect(platform.status).toBe(400);
    expect((await platform.json()).error).toMatch(/macos, ios, android/);

    const version = await adminRoute.PUT(putRequest({ ...body, version: "1.2" }), params("macos"));
    expect(version.status).toBe(400);
    expect((await version.json()).error).toBe(RELEASE_VERSION_MESSAGE);

    const url = await adminRoute.PUT(putRequest({ ...body, downloadUrl: "http://x.y/z" }), params("macos"));
    expect(url.status).toBe(400);
    expect((await url.json()).error).toBe(RELEASE_URL_MESSAGE);

    const junk = await adminRoute.PUT(putRequest("{not json"), params("macos"));
    expect(junk.status).toBe(400);

    const del = await adminRoute.DELETE(putRequest(null), params("web"));
    expect(del.status).toBe(400);
    expect(await getAppRelease(db, "macos")).toBeNull();
  });

  it("503s both writes without a master DB", async () => {
    masterCtx = null;
    const put = await adminRoute.PUT(putRequest(body), params("macos"));
    expect(put.status).toBe(503);
    const del = await adminRoute.DELETE(putRequest(null), params("macos"));
    expect(del.status).toBe(503);
  });

  it("round-trips: PUT → public GET shows it → DELETE → GET empty", async () => {
    const put = await adminRoute.PUT(putRequest(body), params("macos"));
    expect(put.status).toBe(200);
    const { release } = (await put.json()) as { release: AppRelease };
    expect(release).toMatchObject({
      platform: "macos",
      version: "0.2.0",
      build: "2",
      minSupportedVersion: null,
      downloadUrl: MACOS_URL,
      releaseNotes: null,
    });
    expect(new Date(release.publishedAt).toISOString()).toBe(release.publishedAt);
    expect(release.updatedAt).toBe(release.publishedAt);

    const shown = await publicRoute.GET(getRequest());
    const parsed = appReleasesResponseSchema.parse(await shown.json());
    expect(parsed.releases.macos).toEqual(release);
    expect(parsed.releases.ios).toBeUndefined();

    const del = await adminRoute.DELETE(putRequest(null), params("macos"));
    expect(del.status).toBe(204);
    // Idempotent: clearing an already-clear platform is still a 204.
    expect((await adminRoute.DELETE(putRequest(null), params("macos"))).status).toBe(204);

    const after = await publicRoute.GET(getRequest());
    expect(await after.json()).toEqual({ releases: {} });
  });

  it("keeps publishedAt when re-saving the same version+build, restamps it for a new one", async () => {
    const first = (await (await adminRoute.PUT(putRequest(body), params("macos"))).json()) as { release: AppRelease };
    await new Promise((r) => setTimeout(r, 5));

    const edited = (await (
      await adminRoute.PUT(putRequest({ ...body, releaseNotes: "Fixes the sidebar." }), params("macos"))
    ).json()) as { release: AppRelease };
    expect(edited.release.releaseNotes).toBe("Fixes the sidebar.");
    expect(edited.release.publishedAt).toBe(first.release.publishedAt);
    expect(edited.release.updatedAt > first.release.updatedAt).toBe(true);

    const bumped = (await (
      await adminRoute.PUT(putRequest({ ...body, build: "3" }), params("macos"))
    ).json()) as { release: AppRelease };
    expect(bumped.release.publishedAt > first.release.publishedAt).toBe(true);

    const explicit = (await (
      await adminRoute.PUT(putRequest({ ...body, version: "0.3.0", publishedAt: "2026-09-01T00:00:00.000Z" }), params("macos"))
    ).json()) as { release: AppRelease };
    expect(explicit.release.publishedAt).toBe("2026-09-01T00:00:00.000Z");

    // Only one row per platform ever exists.
    expect((await listAppReleases(db)).length).toBe(1);
  });
});
