import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CredentialCipher } from "../packages/db/src/credential-cipher.ts";
import {
  buildPlan,
  canonicalSourceDigest,
  digest,
  assertEmptyTenant,
  assertBeforeImages,
  assertAfterImages,
  assertPauseReceipt,
  ensureAuthUsers,
  resolveSubjects,
  writePrivate,
  markerFor,
  assertImportedUser,
  rollbackState,
  assertRollbackState,
  mutateRow,
  lockMaster,
  boundedFetch,
  options,
  providersFromUsers,
  assertAuthSnapshot,
} from "./legacy-master-import.mjs";
const owner = "11111111-1111-4111-8111-111111111111",
  subject = "22222222-2222-4222-8222-222222222222",
  fresh = "33333333-3333-4333-8333-333333333333",
  created = "44444444-4444-4444-8444-444444444444";
const now = "2026-10-05T00:00:00.000Z";
const cipher = new CredentialCipher(Buffer.alloc(32, 7).toString("base64"));
function fixture() {
  const tenants = ["user_Owner", "user_New"].map((id, i) => ({
    clerk_user_id: id,
    db_name: `old-${i}`,
    db_url: `libsql://old-${i}-team.turso.io`,
    db_auth_token: `legacy-private-${i}`,
    status: "active",
    created_at: now,
    plan: "free",
  }));
  const rows = {
    tenants,
    usage: [
      {
        user_id: "user_Owner",
        day: "2026-09-01",
        saves: 4,
        sessions: 2,
        chats: 1,
        searches: 3,
        newtabTemplates: 8,
      },
      {
        user_id: "user_New",
        day: "2026-09-02",
        saves: 3,
        sessions: 1,
        chats: 0,
        searches: 2,
        newtabTemplates: 0,
      },
    ],
    platform_config: [
      { key: `posthog_budget:${"a".repeat(64)}:2026-10`, value: "17", updated_at: now },
    ],
    app_releases: [
      {
        platform: "macos",
        version: "1.0",
        build: "1",
        min_supported_version: null,
        download_url: "https://example.test/app",
        release_notes: null,
        published_at: now,
        updated_at: now,
      },
    ],
    macos_auth_flows: [{ flow_id: "old-secret-code", state: "approved" }],
    schema_migrations: [{ version: 6, name: "legacy", applied_at: now }],
  };
  const source = {
    capturedAt: now,
    tables: Object.fromEntries(
      Object.entries(rows).map(([name, rows]) => [name, { schema: `create table ${name}`, rows }]),
    ),
  };
  const clerk = ["user_Owner", "user_New"].map((id, i) => ({
    id,
    primary_email_address_id: `em${i}`,
    email_addresses: [
      {
        id: `em${i}`,
        email_address: `user${i}@example.test`,
        verification: { status: "verified" },
      },
    ],
    external_accounts: i
      ? []
      : [
          {
            provider: "oauth_google",
            provider_user_id: "google-real-subject",
            id: "external-account-is-not-subject",
          },
        ],
  }));
  const users = [
    { id: subject, email: "user0@example.test", email_confirmed_at: now, app_metadata: {} },
  ];
  const providers = [
    {
      user_id: subject,
      provider: "google",
      subject: "google-real-subject",
      provider_id: "google-real-subject",
    },
  ];
  const target = {
    schema: [],
    tables: {
      accounts: [{ id: owner, state: "active", created_at: now }],
      identities: [{ provider: "supabase", subject, account_id: owner }],
      tenants: [
        {
          account_id: owner,
          db_name: `bmai-sbqa-${"a".repeat(24)}`,
          db_url: `libsql://bmai-sbqa-${"a".repeat(24)}-team.turso.io`,
          credential_ciphertext: cipher.encrypt("qa-private", owner),
          status: "active",
          plan: "free",
          created_at: now,
        },
      ],
      tenant_operations: [
        {
          account_id: owner,
          kind: "provision",
          db_name: `bmai-sbqa-${"a".repeat(24)}`,
          stage: "complete",
          owned: true,
          provider_subject: subject,
          lease_id: null,
          lease_until: null,
          updated_at: now,
        },
      ],
      legacy_imports: [],
      usage: [],
      analytics_budgets: [],
      platform_config: [],
      app_releases: [],
      session_labels: [{ session_id: "kept" }],
      native_auth_flows: [{ flow_id: "kept" }],
    },
  };
  const business = {
    bookmarks: 0,
    sessions: 0,
    user_settings: 0,
    mcp_tokens: 0,
    chat_conversations: 0,
    chat_messages: 0,
    live_settings: 0,
    schema_migrations: 13,
    bookmarks_fts_config: 1,
    bookmarks_fts_data: 2,
    libsql_vector_meta_shadow: 2,
  };
  const audits = [
    ...tenants.map((t) => ({
      kind: "legacy",
      owner: t.clerk_user_id,
      tables: { bookmarks: 10 },
      contentDigest: digest(t.clerk_user_id),
    })),
    { kind: "displaced-current", owner, tables: business, contentDigest: digest("displaced") },
  ];
  return {
    source,
    clerk,
    users,
    providers,
    target,
    audits,
    cipher,
    keyFingerprint: digest("key"),
    now,
    idFactory: () => fresh,
  };
}
function result(f = fixture(), extra = {}) {
  return buildPlan({ ...f, ...extra });
}
function appliedTarget(f, plan) {
  const out = structuredClone(f.target);
  for (const c of plan.changes) {
    out.tables[c.table] ??= [];
    out.tables[c.table] = out.tables[c.table].filter(
      (r) => !Object.entries(c.key).every(([k, v]) => r[k] === v),
    );
    if (c.after) out.tables[c.table].push(structuredClone(c.after));
  }
  return out;
}

test("source digest ignores export order/capture time but binds schema and every row", () => {
  const f = fixture();
  const s = structuredClone(f.source);
  s.capturedAt = "later";
  s.tables.tenants.rows.reverse();
  assert.equal(canonicalSourceDigest(s), canonicalSourceDigest(f.source));
  s.tables.usage.rows[0].newtabTemplates++;
  assert.notEqual(canonicalSourceDigest(s), canonicalSourceDigest(f.source));
  s.tables.usage.schema += " changed";
  assert.notEqual(canonicalSourceDigest(s), canonicalSourceDigest(f.source));
});
test("all tables covered; exact Google subject preserves owner UUID and all counters", () => {
  const f = fixture(),
    p = result(f);
  assert.equal(p.mappings[0].accountId, owner);
  assert.equal(p.mappings[0].subject, subject);
  assert.equal(p.mappings[1].accountId, fresh);
  assert.equal(
    p.changes.find((c) => c.table === "usage" && c.key.account_id === owner).after.newtab_templates,
    8,
  );
  assert.equal(p.changes.find((c) => c.table === "analytics_budgets").after.count, 17);
  assert.deepEqual(p.archivedOnly, ["macos_auth_flows", "schema_migrations"]);
  assert.ok(
    !p.changes.some((c) =>
      ["session_labels", "native_auth_flows", "macos_auth_flows", "tenant_operations"].includes(
        c.table,
      ),
    ),
  );
  const route = p.changes.find((c) => c.table === "tenants" && c.key.account_id === fresh);
  assert.equal(cipher.decrypt(route.after.credential_ciphertext, fresh), "legacy-private-1");
  assert.throws(() => cipher.decrypt(route.after.credential_ciphertext, owner));
});
test("dormant-only preparation does not touch current owner even when displaced tenant has user activity", () => {
  const f = fixture();
  f.audits[2].tables.chat_messages = 2;
  const p = result(f, { only: "dormant-new" });
  assert.equal(p.mappings.length, 1);
  assert.equal(p.mappings[0].clerkSubject, "user_New");
  assert.ok(!p.changes.some((c) => c.key.account_id === owner));
  assert.throws(() => result(f), /not empty/);
});
test("refuses unknown master table, unverified primary email, duplicate email and wrong provider subject", () => {
  let f = fixture();
  f.source.tables.uncovered = { schema: "x", rows: [] };
  assert.throws(() => result(f), /Uncovered/);
  f = fixture();
  f.clerk[1].email_addresses[0].verification.status = "unverified";
  assert.throws(() => result(f), /verified/);
  f = fixture();
  f.clerk[1].email_addresses[0].email_address = "USER0@example.test";
  assert.throws(() => result(f), /authorized import|Nonunique/);
  f = fixture();
  f.providers[0].subject = "external-account-is-not-subject";
  assert.throws(() => result(f), /authorized import/);
});
test("refuses route collisions, pending operations and business data hidden by metadata exemptions", () => {
  let f = fixture();
  f.target.tables.tenants.push({
    ...f.target.tables.tenants[0],
    account_id: created,
    db_name: "old-1",
  });
  assert.throws(() => result(f), /another account/);
  f = fixture();
  f.target.tables.tenant_operations[0].stage = "pending";
  assert.throws(() => result(f), /Pending/);
  const a = { tables: { ...fixture().audits[2].tables, unknown_future_table: 1 } };
  assert.throws(() => assertEmptyTenant(a), /not empty/);
  a.tables.unknown_future_table = 0;
  delete a.tables.mcp_tokens;
  assert.throws(() => assertEmptyTenant(a), /incomplete/);
});
test("usage/global conflicts refuse overwrite; same values avoid duplicate budget and release import", () => {
  let f = fixture();
  f.target.tables.analytics_budgets = [
    { project_hash: "a".repeat(64), month: "2026-10", count: 19 },
  ];
  assert.throws(() => result(f), /analytics_budgets conflict/);
  f = fixture();
  f.target.tables.analytics_budgets = [
    { project_hash: "a".repeat(64), month: "2026-10", count: 17 },
  ];
  f.target.tables.app_releases = f.source.tables.app_releases.rows;
  const p = result(f);
  assert.ok(!p.changes.some((c) => ["analytics_budgets", "app_releases"].includes(c.table)));
  f.target.tables.usage = [
    {
      account_id: owner,
      day: "2026-09-01",
      saves: 100,
      sessions: 2,
      chats: 1,
      searches: 3,
      newtab_templates: 8,
    },
  ];
  assert.throws(() => result(f), /usage conflict/);
});
test("existing exact provenance skips route and owner usage including postimport counters", () => {
  const f = fixture(),
    p = result(f);
  const existing = p.changes
    .filter((c) => c.table === "tenants" || c.table === "legacy_imports")
    .filter((c) => c.key.account_id === owner);
  for (const c of existing) f.target.tables[c.table] = [c.after];
  f.target.tables.usage = [
    {
      account_id: owner,
      day: "2026-09-01",
      saves: 999,
      sessions: 2,
      chats: 1,
      searches: 3,
      newtab_templates: 8,
    },
  ];
  const next = result(f);
  assert.ok(next.mappings[0].alreadyImported);
  assert.ok(!next.changes.some((c) => c.key.account_id === owner));
  f.target.tables.legacy_imports[0].source_digest = "b".repeat(64);
  assert.throws(() => result(f), /provenance conflict/);
});
test("before-image CAS rejects changed counters, account state and reverse ownership", () => {
  const f = fixture(),
    p = result(f);
  assertBeforeImages(p, f.target);
  let t = structuredClone(f.target);
  t.tables.accounts[0].state = "deleting";
  assert.throws(() => assertBeforeImages(p, t), /before-image/);
  t = structuredClone(f.target);
  t.tables.identities.push({ provider: "supabase", subject: created, account_id: fresh });
  assert.throws(() => assertBeforeImages(p, t), /reverse identity/);
  t = structuredClone(f.target);
  t.tables.tenants[0].plan = "pro";
  assert.throws(() => assertBeforeImages(p, t), /before-image/);
});
test("drain uses finite committed timestamp, 330-second minimum and exact paused before-image", () => {
  const f = fixture(),
    p = result(f),
    before = f.target.tables.tenants[0];
  const receipt = {
    version: 1,
    sourceDigest: p.sourceDigest,
    stage: "paused",
    externalWritersBlocked: true,
    protectionEvidence: digest("verified"),
    maxInflightSeconds: 300,
    committedAt: now,
    pauses: [{ before }],
  };
  assert.throws(() => assertPauseReceipt(p, receipt, Date.parse(now) + 329999), /drain/);
  assertPauseReceipt(p, receipt, Date.parse(now) + 330000);
  for (const invalid of ["bad", null, "2027-01-01"])
    assert.throws(
      () => assertPauseReceipt(p, { ...receipt, committedAt: invalid }, Date.parse(now) + 330000),
      /drain/,
    );
  const t = structuredClone(f.target);
  t.tables.tenants[0].status = "disabled";
  assertBeforeImages(p, t, { pauseReceipt: receipt });
  receipt.pauses[0].before = { ...before, db_url: "changed" };
  assert.throws(() => assertPauseReceipt(p, receipt, Date.parse(now) + 330000), /before-image/);
});
test("Auth creation is no-password/no-email, receipt intent precedes creation and returned UUID precedes master use", async () => {
  const p = result(fixture(), { only: "dormant-new" });
  const events = [],
    journal = { auth: {} };
  let stored;
  const admin = {
    listUsers: async () => [],
    createUser: async (attrs) => {
      events.push("create");
      assert.deepEqual(Object.keys(attrs).sort(), ["app_metadata", "email", "email_confirm"]);
      assert.equal(attrs.email_confirm, true);
      return (stored = {
        id: created,
        email: attrs.email,
        email_confirmed_at: now,
        app_metadata: attrs.app_metadata,
      });
    },
    getUserById: async () => stored,
  };
  const subjects = await ensureAuthUsers(p, admin, journal, async (j) =>
    events.push(j.auth.user_New.stage),
  );
  assert.deepEqual(events, ["intent", "create", "created"]);
  assert.equal(subjects.user_New, created);
  assert.equal(
    resolveSubjects(p, subjects).changes.find((c) => c.table === "identities").after.subject,
    created,
  );
});
test("lost Auth response recovers via server-only marker without second creation", async () => {
  const p = result(fixture(), { only: "dormant-new" }),
    journal = { auth: {} },
    m = p.mappings[0];
  let remote,
    creates = 0;
  const admin = {
    listUsers: async () => (remote ? [remote] : []),
    createUser: async (attrs) => {
      creates++;
      remote = {
        id: created,
        email: attrs.email,
        email_confirmed_at: now,
        app_metadata: attrs.app_metadata,
      };
      throw new Error("lost response");
    },
    getUserById: async () => remote,
  };
  await assert.rejects(() => ensureAuthUsers(p, admin, journal, async () => {}), /lost/);
  assert.equal(journal.auth.user_New.stage, "intent");
  await ensureAuthUsers(p, admin, journal, async () => {});
  assert.equal(creates, 1);
  assert.equal(journal.auth.user_New.subject, created);
  assertImportedUser(remote, markerFor(p.sourceDigest, m.clerkSubject, m.accountId), m.email);
});
test("Auth receipt/email/marker collision is refused, never relinks a different user", async () => {
  const p = result(fixture(), { only: "dormant-new" }),
    journal = { auth: {} };
  let creates = 0;
  const admin = {
    listUsers: async () => [
      { id: created, email: p.mappings[0].email, email_confirmed_at: now, app_metadata: {} },
    ],
    createUser: async () => {
      creates++;
    },
  };
  await assert.rejects(() => ensureAuthUsers(p, admin, journal, async () => {}), /marker/);
  assert.equal(creates, 0);
});
test("rollback guards both changed imported rows and new owner usage even when tenant counts remain unchanged", () => {
  const f = fixture(),
    p = resolveSubjects(result(f), { user_Owner: subject, user_New: created }),
    after = appliedTarget(f, p),
    baseline = rollbackState(p, after);
  assertAfterImages(p.changes, after);
  assertRollbackState(baseline, after);
  after.tables.usage.push({
    account_id: fresh,
    day: "2026-10-05",
    saves: 1,
    sessions: 0,
    chats: 0,
    searches: 0,
    newtab_templates: 0,
  });
  assert.throws(() => assertRollbackState(baseline, after), /Postimport/);
  after.tables.tenants.find((t) => t.account_id === fresh).plan = "pro";
  assert.throws(() => assertAfterImages(p.changes, after), /rollback refused/);
});
test("Postgres inferred JSONB receives objects, preserving structural before-images", async () => {
  const c = result().changes.find(
    (c) => c.table === "legacy_imports" && c.key.account_id === owner,
  );
  const calls = [];
  await mutateRow(
    {
      unsafe: async (q, args) => {
        calls.push({ q, args });
        return [];
      },
    },
    c,
  );
  const insert = calls[1];
  assert.match(insert.q, /insert into/);
  const columns = Object.keys(c.after);
  assert.equal(typeof insert.args[columns.indexOf("prior_tenant")], "object");
  assert.deepEqual(insert.args[columns.indexOf("prior_tenant")], c.after.prior_tenant);
  assert.equal(typeof insert.args[columns.indexOf("prior_operation")], "object");
});
test("mutation CAS checks locked actual row before any UPDATE", async () => {
  const c = result().changes.find((c) => c.table === "tenants" && c.key.account_id === owner),
    calls = [];
  await assert.rejects(
    () =>
      mutateRow(
        {
          unsafe: async (q) => {
            calls.push(q);
            return [{ ...c.before, plan: "changed" }];
          },
        },
        c,
      ),
    /Changed tenants/,
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /for update/);
});
test("lock ordering handles dormant null subjects and uses runtime matching advisory namespace", async () => {
  const p = result(),
    calls = [];
  await lockMaster(
    {
      unsafe: async (q, args) => {
        calls.push({ q, args });
        return [];
      },
    },
    p,
  );
  assert.equal(calls.filter((c) => c.q.includes("pg_advisory")).length, 2);
  assert.ok(calls.some((c) => c.args?.[0] === `supabase:${subject}`));
  assert.ok(calls.some((c) => c.args?.[0] === `supabase:${fresh}`));
  assert.match(calls.at(-1).q, /share row exclusive/);
});
test("bounded provider requests abort a hung fetch instead of holding migration indefinitely", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) =>
    new Promise((_, reject) =>
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }),
    );
  const timer = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(() => boundedFetch("https://example.test", {}, 15), /timed out|timeout/i);
  } finally {
    clearTimeout(timer);
    globalThis.fetch = original;
  }
});
test("private receipts are mode600 and strict command modes reject accidental mutation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "master-import-"));
  try {
    const file = path.join(dir, "receipt.json");
    writePrivate(file, { subject: created });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(file)).subject, created);
    writePrivate(file, { stage: "next" });
    assert.equal(JSON.parse(fs.readFileSync(file)).stage, "next");
    assert.deepEqual(options([]), {});
    assert.throws(() => options(["--apply", "--rollback"]), /one mutation/);
    assert.throws(() => options(["--unknown"]), /Unknown/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("detailed admin identities bind actual Google sub; list-only omission and changed sub fail closed", () => {
  const f = fixture(),
    p = resolveSubjects(result(f), { user_Owner: subject, user_New: created });
  const users = [
    {
      ...f.users[0],
      identities: [
        {
          provider: "google",
          id: "wrong-external-record-id",
          identity_data: { sub: "google-real-subject" },
        },
      ],
    },
    {
      id: created,
      email: "user1@example.test",
      email_confirmed_at: now,
      app_metadata: { legacy_master_import: p.mappings[1].authMarker },
      identities: [{ provider: "email", identity_data: { sub: created } }],
    },
  ];
  assertAuthSnapshot(p, users);
  assert.equal(providersFromUsers(users)[0].subject, "google-real-subject");
  delete users[0].identities;
  assert.throws(() => assertAuthSnapshot(p, users), /inventory unavailable/);
  users[0].identities = [{ provider: "google", identity_data: { sub: "changed-provider" } }];
  assert.throws(() => assertAuthSnapshot(p, users), /Google provider/);
});
