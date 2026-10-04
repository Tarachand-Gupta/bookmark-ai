#!/usr/bin/env node
/** Private control-plane import. Dry run is default. Never imports old credentials as authentication. */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CredentialCipher } from "../packages/db/src/credential-cipher.ts";

const SOURCE_TABLES = [
  "app_releases",
  "macos_auth_flows",
  "platform_config",
  "schema_migrations",
  "tenants",
  "usage",
];
const KEYS = {
  accounts: ["id"],
  identities: ["provider", "subject"],
  tenants: ["account_id"],
  legacy_imports: ["account_id"],
  usage: ["account_id", "day"],
  platform_config: ["key"],
  analytics_budgets: ["project_hash", "month"],
  app_releases: ["platform"],
  tenant_operations: ["account_id"],
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
class ImportRefusal extends Error {}
const fail = (message) => {
  throw new ImportRefusal(message);
};
export function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  if (typeof value === "bigint") return Number(value);
  return value;
}
export const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)) ?? "undefined")
    .digest("hex");
const equal = (a, b) => digest(a) === digest(b);
const ordered = (rows) =>
  rows.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
export const canonicalSourceDigest = (source) =>
  digest(
    Object.fromEntries(
      Object.entries(source.tables)
        .sort()
        .map(([k, v]) => [k, { schema: v.schema, rows: ordered(v.rows) }]),
    ),
  );
export async function boundedFetch(input, init = {}, timeoutMs = 15000) {
  return fetch(input, {
    ...init,
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
  });
}
const normEmail = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase();
function timestamp(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) fail("Invalid source timestamp");
  return d.toISOString();
}
function counter(value) {
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 0 || Number(value) > 2147483647)
    fail("Invalid legacy counter");
  return Number(value);
}
function normalizeRow(table, row) {
  if (!row) return null;
  const r = canonical(row);
  for (const k of ["created_at", "updated_at", "published_at", "imported_at", "lease_until"])
    if (r[k] != null) r[k] = timestamp(r[k]);
  if (table === "usage") {
    r.day = String(r.day).slice(0, 10);
    r.newtab_templates ??= 0;
  }
  return canonical(r);
}
const keyOf = (table, row) => Object.fromEntries(KEYS[table].map((k) => [k, row[k]]));
function findRow(target, table, key) {
  const found = (target.tables[table] ?? []).filter((r) =>
    Object.entries(key).every(([k, v]) => normalizeRow(table, r)[k] === v),
  );
  if (found.length > 1) fail("Duplicate target key");
  return normalizeRow(table, found[0]);
}
function unique(values, label) {
  if (new Set(values).size !== values.length) fail(`Nonunique ${label}`);
}
function routeValid(row) {
  if (
    !/^user_[A-Za-z0-9]+$/.test(row.clerk_user_id) ||
    !/^[a-z0-9-]+$/.test(row.db_name) ||
    !row.db_auth_token ||
    row.status !== "active"
  )
    fail("Unsupported legacy tenant");
  const u = new URL(row.db_url);
  if (
    u.protocol !== "libsql:" ||
    !u.hostname.endsWith(".turso.io") ||
    !(u.hostname.startsWith(row.db_name + "-") || u.hostname.startsWith(row.db_name + "."))
  )
    fail("Legacy database name/URL mismatch");
}
export function assertEmptyTenant(audit) {
  if (!audit || audit.error) fail("Displaced tenant audit unavailable");
  const metadata = new Set([
    "schema_migrations",
    "bookmarks_fts_config",
    "bookmarks_fts_data",
    "libsql_vector_meta_shadow",
  ]);
  for (const [name, count] of Object.entries(audit.tables))
    if (!metadata.has(name) && count !== 0) fail("Displaced tenant is not empty");
  for (const name of [
    "bookmarks",
    "sessions",
    "user_settings",
    "mcp_tokens",
    "chat_conversations",
    "chat_messages",
    "live_settings",
  ])
    if (audit.tables[name] !== 0) fail("Displaced tenant business-table audit incomplete");
}
export function markerFor(sourceHash, clerkSubject, accountId) {
  return {
    version: 1,
    source_digest: sourceHash,
    clerk_subject: clerkSubject,
    account_id: accountId,
  };
}
export function assertImportedUser(user, marker, email) {
  if (
    !user ||
    !uuid.test(user.id) ||
    normEmail(user.email) !== normEmail(email) ||
    !user.email_confirmed_at ||
    !equal(user.app_metadata?.legacy_master_import, marker)
  )
    fail("Auth import marker/subject conflict");
  return user.id;
}
/** All nondeterminism (UUIDs, timestamps, encryption) is frozen in the private reviewed manifest. */
export function buildPlan({
  source,
  clerk,
  users,
  providers,
  target,
  audits,
  cipher,
  keyFingerprint,
  only = "all",
  now = new Date().toISOString(),
  idFactory = randomUUID,
}) {
  if (!["all", "existing-provider-match", "dormant-new"].includes(only))
    fail("Unsupported import selection");
  if (!equal(Object.keys(source.tables).sort(), SOURCE_TABLES))
    fail("Uncovered legacy master table");
  const hash = canonicalSourceDigest(source);
  const tenants = source.tables.tenants.rows;
  unique(
    tenants.map((r) => r.clerk_user_id),
    "legacy owners",
  );
  unique(
    tenants.map((r) => r.db_name),
    "legacy database names",
  );
  unique(
    tenants.map((r) => r.db_url),
    "legacy database URLs",
  );
  const changes = [];
  const mappings = [];
  const expectations = [];
  const add = (table, key, after, { replace = false } = {}) => {
    const before = findRow(target, table, key);
    after = normalizeRow(table, after);
    if (equal(before, after)) return;
    if (before && !replace) fail(`Target ${table} conflict`);
    changes.push({ table, key, before, after });
  };
  const expect = (table, key) =>
    expectations.push({ table, key, row: findRow(target, table, key) });
  const emails = [];
  for (const t of tenants) {
    routeValid(t);
    const old = clerk.filter((u) => u.id === t.clerk_user_id);
    if (old.length !== 1 || old[0].banned || old[0].locked)
      fail("Missing/disabled authoritative Clerk owner");
    const primary = old[0].email_addresses?.filter(
      (e) => e.id === old[0].primary_email_address_id && e.verification?.status === "verified",
    );
    if (primary?.length !== 1) fail("Missing unique verified primary email");
    const email = normEmail(primary[0].email_address);
    if (!email) fail("Empty verified email");
    emails.push(email);
    const external = (old[0].external_accounts ?? []).filter(
      (e) => e.provider === "oauth_google" && e.provider_user_id != null,
    );
    const matches = providers.filter(
      (p) =>
        p.provider === "google" &&
        external.some((e) => String(e.provider_user_id) === String(p.subject)),
    );
    unique(
      matches.map((p) => p.user_id),
      "provider subjects",
    );
    if (matches.length > 1) fail("Ambiguous provider identity");
    const emailUsers = users.filter((u) => normEmail(u.email) === email);
    if (emailUsers.length > 1) fail("Ambiguous Supabase email");
    let subject = matches[0]?.user_id ?? null,
      accountId = null,
      evidence = subject ? "provider-subject" : "admin-verified-email",
      authMarker = null;
    if (subject) {
      if (only === "dormant-new") continue;
      if (!uuid.test(subject) || !users.some((u) => u.id === subject && u.email_confirmed_at))
        fail("Unverified matched provider owner");
      if (emailUsers.some((u) => u.id !== subject)) fail("Provider/email collision");
      const ids = (target.tables.identities ?? []).filter(
        (i) => i.provider === "supabase" && i.subject === subject,
      );
      if (ids.length !== 1) fail("Matched provider has no unique canonical account");
      accountId = ids[0].account_id;
    } else {
      if (emailUsers.length) {
        const m = emailUsers[0].app_metadata?.legacy_master_import;
        if (
          !m ||
          m.source_digest !== hash ||
          m.clerk_subject !== t.clerk_user_id ||
          !uuid.test(m.account_id)
        )
          fail("Existing Supabase email is not an authorized import");
        accountId = m.account_id;
        authMarker = markerFor(hash, t.clerk_user_id, accountId);
        subject = assertImportedUser(emailUsers[0], authMarker, email);
      } else {
        accountId = idFactory();
        authMarker = markerFor(hash, t.clerk_user_id, accountId);
      }
      if (only === "existing-provider-match") continue;
    }
    if (!uuid.test(accountId)) fail("Invalid canonical UUID");
    const audit = audits.find((a) => a.kind === "legacy" && a.owner === t.clerk_user_id);
    if (!audit || audit.error || !sha.test(audit.contentDigest))
      fail("Missing fresh legacy tenant content audit");
    const account = findRow(target, "accounts", { id: accountId });
    if (account && account.state !== "active") fail("Canonical account is not active");
    if (!account && evidence === "provider-subject") fail("Canonical account missing");
    const priorTenant = findRow(target, "tenants", { account_id: accountId });
    const priorOperation = findRow(target, "tenant_operations", { account_id: accountId });
    const imported = findRow(target, "legacy_imports", { account_id: accountId });
    const collision = (target.tables.tenants ?? []).find(
      (r) => r.account_id !== accountId && (r.db_name === t.db_name || r.db_url === t.db_url),
    );
    if (collision) fail("Legacy route belongs to another account");
    const reverse = (target.tables.identities ?? []).filter((r) => r.account_id === accountId);
    if (reverse.some((r) => r.provider !== "supabase" || r.subject !== subject))
      fail("Reverse canonical identity collision");
    if (
      priorOperation &&
      (priorOperation.kind !== "provision" ||
        priorOperation.stage !== "complete" ||
        priorOperation.lease_id ||
        priorOperation.lease_until)
    )
      fail("Pending or leased tenant operation");
    if (imported) {
      if (
        imported.clerk_subject !== t.clerk_user_id ||
        imported.db_name !== t.db_name ||
        imported.db_url !== t.db_url ||
        imported.source_digest !== hash ||
        imported.identity_evidence !== evidence ||
        !priorTenant ||
        priorTenant.db_name !== t.db_name ||
        priorTenant.db_url !== t.db_url
      )
        fail("Imported provenance conflict");
    } else if (priorTenant) {
      if (
        priorTenant.status !== "active" ||
        !/^bmai-sbqa-[a-f0-9]{24,64}$/.test(priorTenant.db_name)
      )
        fail("Displaced route is not an active QA tenant");
      const displaced = audits.find((a) => a.kind === "displaced-current" && a.owner === accountId);
      assertEmptyTenant(displaced);
      if (!sha.test(displaced.contentDigest)) fail("Missing fresh displaced content digest");
    }
    mappings.push({
      clerkSubject: t.clerk_user_id,
      email,
      subject,
      accountId,
      evidence,
      ...(evidence === "provider-subject"
        ? { googleProviderSubject: String(matches[0].subject) }
        : {}),
      authMarker,
      legacyContentDigest: audit.contentDigest,
      displacedContentDigest: imported
        ? null
        : (audits.find((a) => a.kind === "displaced-current" && a.owner === accountId)
            ?.contentDigest ?? null),
      alreadyImported: !!imported,
    });
    expect("accounts", { id: accountId });
    expect("tenant_operations", { account_id: accountId });
    expect("identities", { provider: "supabase", subject: subject ?? `$auth:${t.clerk_user_id}` });
    if (!account)
      add("accounts", { id: accountId }, { id: accountId, state: "active", created_at: now });
    if (!subject || !findRow(target, "identities", { provider: "supabase", subject }))
      add(
        "identities",
        { provider: "supabase", subject: subject ?? `$auth:${t.clerk_user_id}` },
        {
          provider: "supabase",
          subject: subject ?? `$auth:${t.clerk_user_id}`,
          account_id: accountId,
        },
      );
    if (!imported) {
      add(
        "legacy_imports",
        { account_id: accountId },
        {
          account_id: accountId,
          clerk_subject: t.clerk_user_id,
          db_name: t.db_name,
          db_url: t.db_url,
          source_digest: hash,
          identity_evidence: evidence,
          prior_tenant: priorTenant,
          prior_operation: priorOperation,
          imported_at: now,
        },
      );
      add(
        "tenants",
        { account_id: accountId },
        {
          account_id: accountId,
          db_name: t.db_name,
          db_url: t.db_url,
          credential_ciphertext: cipher.encrypt(t.db_auth_token, accountId),
          status: "active",
          plan: t.plan ?? "free",
          created_at: timestamp(t.created_at),
        },
        { replace: !!priorTenant },
      );
    }
  }
  unique(emails, "verified primary emails");
  unique(
    mappings.map((m) => m.accountId),
    "canonical account mapping",
  );
  unique(mappings.map((m) => m.subject).filter(Boolean), "Supabase owner mapping");
  for (const row of source.tables.usage.rows) {
    const m = mappings.find((m) => m.clerkSubject === row.user_id);
    if (!tenants.some((t) => t.clerk_user_id === row.user_id)) fail("Orphan legacy usage owner");
    if (!m || m.alreadyImported) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day)) fail("Invalid usage day");
    add(
      "usage",
      { account_id: m.accountId, day: row.day },
      {
        account_id: m.accountId,
        day: row.day,
        ...Object.fromEntries(
          ["saves", "sessions", "chats", "searches"].map((k) => [k, counter(row[k])]),
        ),
        newtab_templates: counter(row.newtabTemplates ?? 0),
      },
    );
  }
  for (const row of source.tables.platform_config.rows) {
    const budget = row.key.match(/^posthog_budget:([a-f0-9]{64}):(\d{4}-(?:0[1-9]|1[0-2]))$/);
    if (row.key.startsWith("posthog_budget:") && !budget) fail("Malformed analytics budget key");
    if (budget) {
      if (!/^\d+$/.test(row.value)) fail("Invalid analytics budget count");
      add(
        "analytics_budgets",
        { project_hash: budget[1], month: budget[2] },
        { project_hash: budget[1], month: budget[2], count: counter(row.value) },
      );
    } else add("platform_config", { key: row.key }, row);
  }
  for (const row of source.tables.app_releases.rows)
    add("app_releases", { platform: row.platform }, row);
  return canonical({
    version: 1,
    selection: only,
    createdAt: now,
    sourceDigest: hash,
    keyFingerprint,
    mappings,
    changes,
    expectations,
    sourceCounts: Object.fromEntries(
      Object.entries(source.tables).map(([k, v]) => [k, v.rows.length]),
    ),
    archivedOnly: ["macos_auth_flows", "schema_migrations"],
    unmodifiedTarget: [
      "macos_auth_flows",
      "native_auth_flows",
      "session_labels",
      "tenant_operations",
    ],
    schema: target.schema,
  });
}
export function assertBeforeImages(plan, target, { pauseReceipt = null } = {}) {
  for (const item of [
    ...plan.expectations.map((e) => ({ table: e.table, key: e.key, before: e.row })),
    ...plan.changes,
  ]) {
    const actual = findRow(target, item.table, item.key);
    let expected = item.before;
    if (item.table === "tenants" && pauseReceipt) {
      const p = pauseReceipt.pauses.find((p) => p.before.account_id === item.key.account_id);
      if (p && equal(expected, p.before)) expected = { ...p.before, status: "disabled" };
    }
    if (!equal(actual, expected)) fail(`Changed target ${item.table} before-image`);
  }
  for (const m of plan.mappings) {
    const others = (target.tables.identities ?? []).filter((i) => i.account_id === m.accountId);
    if (others.some((i) => i.provider !== "supabase" || i.subject !== m.subject))
      fail("Changed reverse identity mapping");
    if (
      (target.tables.tenants ?? []).some(
        (t) =>
          t.account_id !== m.accountId &&
          (t.db_name ===
            plan.changes.find(
              (c) => c.table === "legacy_imports" && c.key.account_id === m.accountId,
            )?.after.db_name ||
            t.db_url ===
              plan.changes.find(
                (c) => c.table === "legacy_imports" && c.key.account_id === m.accountId,
              )?.after.db_url),
      )
    )
      fail("Changed reverse route mapping");
  }
}
export function rollbackState(plan, target) {
  return plan.mappings.map((m) => ({
    accountId: m.accountId,
    digest: digest(
      Object.fromEntries(
        ["accounts", "identities", "tenants", "legacy_imports", "usage", "tenant_operations"].map(
          (table) => [
            table,
            ordered(
              (target.tables[table] ?? [])
                .filter((r) => (r.account_id ?? r.id) === m.accountId)
                .map((r) => normalizeRow(table, r)),
            ),
          ],
        ),
      ),
    ),
  }));
}
export function assertRollbackState(expected, target) {
  for (const owner of expected) {
    const current = rollbackState({ mappings: [{ accountId: owner.accountId }] }, target)[0];
    if (current.digest !== owner.digest)
      fail("Postimport account writes detected; rollback refused");
  }
}
export function assertAfterImages(changes, target) {
  for (const c of changes)
    if (!equal(findRow(target, c.table, c.key), c.after))
      fail(`Changed imported ${c.table}; rollback refused`);
}
export function assertPauseReceipt(plan, receipt, now = Date.now()) {
  const required = plan.changes.filter((c) => c.table === "tenants" && c.before);
  if (!required.length) return;
  if (
    !receipt ||
    receipt.version !== 1 ||
    receipt.sourceDigest !== plan.sourceDigest ||
    receipt.stage !== "paused" ||
    !receipt.externalWritersBlocked ||
    !receipt.protectionEvidence ||
    !Number.isFinite(receipt.maxInflightSeconds) ||
    receipt.maxInflightSeconds < 300
  )
    fail("Verified pause/protection receipt required");
  const committed = Date.parse(receipt.committedAt);
  if (
    !Number.isFinite(committed) ||
    !Number.isFinite(now) ||
    now < committed ||
    now - committed < (receipt.maxInflightSeconds + 30) * 1000
  )
    fail("Pause drain has not completed");
  if (required.some((c) => !receipt.pauses.some((p) => equal(p.before, c.before))))
    fail("Pause before-image mismatch");
}
export async function ensureAuthUsers(plan, admin, journal, save) {
  for (const m of plan.mappings) {
    if (m.evidence === "provider-subject") continue;
    const entry = journal.auth[m.clerkSubject];
    let users = await admin.listUsers();
    let matches = users.filter(
      (u) =>
        normEmail(u.email) === m.email || equal(u.app_metadata?.legacy_master_import, m.authMarker),
    );
    if (matches.length > 1) fail("Auth import identity collision");
    let user = matches[0];
    if (entry?.subject) {
      user = await admin.getUserById(entry.subject);
      assertImportedUser(user, m.authMarker, m.email);
      if (matches.length && matches[0].id !== user.id) fail("Auth receipt/email conflict");
    }
    if (!user) {
      journal.auth[m.clerkSubject] = { stage: "intent", marker: m.authMarker };
      await save(journal);
      user = await admin.createUser({
        email: m.email,
        email_confirm: true,
        app_metadata: { legacy_master_import: m.authMarker },
      });
    }
    const subject = assertImportedUser(user, m.authMarker, m.email);
    if (m.subject && m.subject !== subject) fail("Frozen subject changed");
    journal.auth[m.clerkSubject] = { stage: "created", marker: m.authMarker, subject };
    await save(journal);
  }
  return Object.fromEntries(
    plan.mappings.map((m) => [m.clerkSubject, m.subject ?? journal.auth[m.clerkSubject]?.subject]),
  );
}
export function resolveSubjects(plan, subjects) {
  const replace = (value) =>
    typeof value === "string" && value.startsWith("$auth:")
      ? (subjects[value.slice(6)] ?? fail("Missing durable Auth subject"))
      : Array.isArray(value)
        ? value.map(replace)
        : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)]))
          : value;
  const result = replace(plan);
  for (const m of result.mappings) {
    m.subject = subjects[m.clerkSubject];
    if (!uuid.test(m.subject)) fail("Invalid resolved Auth subject");
  }
  return result;
}
export function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
  const dir = fs.openSync(path.dirname(file), "r");
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
}
function readPrivate(file) {
  if ((fs.statSync(file).mode & 0o077) !== 0) fail("Private input permissions must be 600");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function envFile(file) {
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .flatMap((line) => {
        const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (!m) return [];
        let v = m[2];
        if (v.startsWith('"')) {
          try {
            v = JSON.parse(v);
          } catch {
            fail("Invalid env quoting");
          }
        } else if (v.startsWith("'")) v = v.slice(1, -1);
        return [[m[1], v]];
      }),
  );
}
export function options(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) fail("Use named arguments");
    const [name, ...v] = arg.slice(2).split("=");
    if (
      ![
        "apply",
        "rollback",
        "pause",
        "resume-pause",
        "pause-rollback",
        "import-receipt",
        "help",
        "manifest",
        "reviewed-digest",
        "receipt",
        "pause-receipt",
        "source-dir",
        "env",
        "out",
        "only",
        "protection-evidence",
        "max-inflight-seconds",
      ].includes(name)
    )
      fail("Unknown option");
    out[name] = v.length ? v.join("=") : true;
  }
  if (
    ["apply", "rollback", "pause", "pause-rollback", "resume-pause"].filter((k) => out[k]).length >
    1
  )
    fail("Select one mutation mode");
  return out;
}
const tableName = (n) => {
  if (!/^[a-z_][a-z_0-9]*$/.test(n)) fail("Unsafe table identifier");
  return `"${n}"`;
};
async function readTarget(sql) {
  const tables = await sql.unsafe(
    "select tablename from pg_tables where schemaname='bmai_qa' order by tablename",
  );
  const out = {
    tables: {},
    schema: await sql.unsafe(
      "select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='bmai_qa' order by table_name,ordinal_position",
    ),
  };
  for (const t of tables)
    out.tables[t.tablename] = canonical([
      ...(await sql.unsafe(`select * from bmai_qa.${tableName(t.tablename)}`)),
    ]);
  return out;
}
async function snapshotLegacy(out, libsql) {
  const dbPath = path.join(out, "legacy-master.private.db");
  try {
    execFileSync("turso", ["db", "export", "bookmark-ai-master", "--output-file", dbPath], {
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    fail("Authenticated read-only Turso master export failed");
  }
  fs.chmodSync(dbPath, 0o600);
  const db = libsql({ url: `file:${dbPath}` });
  try {
    const tx = await db.transaction("read");
    const rows = (
      await tx.execute(
        "select name,sql from sqlite_master where type='table' and name not like 'sqlite_%' order by name",
      )
    ).rows;
    const s = { tables: {} };
    for (const t of rows)
      s.tables[t.name] = {
        schema: t.sql,
        rows: canonical([...(await tx.execute(`select * from ${tableName(t.name)}`)).rows]),
      };
    await tx.commit();
    writePrivate(path.join(out, "legacy-master-snapshot.private.json"), s);
    return s;
  } finally {
    db.close();
  }
}
async function auditTenant(libsql, tenant, cipher, kind) {
  const db = libsql({
    url: tenant.db_url,
    authToken:
      kind === "legacy"
        ? tenant.db_auth_token
        : cipher.decrypt(tenant.credential_ciphertext, tenant.account_id),
  });
  try {
    const tx = await db.transaction("read");
    const tables = (
      await tx.execute(
        "select name,sql from sqlite_master where type='table' and name not like 'sqlite_%' order by name",
      )
    ).rows;
    const data = {};
    const counts = {};
    for (const t of tables) {
      const rows = canonical([...(await tx.execute(`select * from ${tableName(t.name)}`)).rows]);
      data[t.name] = { schema: t.sql, rows: ordered(rows) };
      counts[t.name] = rows.length;
    }
    await tx.commit();
    return {
      kind,
      owner: kind === "legacy" ? tenant.clerk_user_id : tenant.account_id,
      tables: counts,
      contentDigest: digest(data),
    };
  } catch {
    fail("Tenant read-only content audit failed");
  } finally {
    db.close();
  }
}
async function listClerk(env) {
  if (!env.CLERK_SECRET_KEY) fail("Preserved Clerk inventory key unavailable");
  const users = [];
  for (let offset = 0; ; offset += 100) {
    const res = await boundedFetch(`https://api.clerk.com/v1/users?limit=100&offset=${offset}`, {
      headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
    });
    if (!res.ok) fail(`Clerk read-only inventory HTTP ${res.status}`);
    const batch = await res.json();
    users.push(...batch);
    if (batch.length < 100) break;
  }
  return users;
}
export function providersFromUsers(users) {
  const result = [];
  for (const user of users) {
    if (!Array.isArray(user.identities)) fail("Detailed admin identity inventory unavailable");
    for (const identity of user.identities) {
      result.push({
        user_id: user.id,
        provider: identity.provider,
        provider_id: identity.id,
        subject: identity.identity_data?.sub,
      });
    }
  }
  return result;
}
export function assertAuthSnapshot(plan, users) {
  const providers = providersFromUsers(users);
  for (const m of plan.mappings) {
    const user = users.find((u) => u.id === m.subject);
    if (!user?.email_confirmed_at) fail("Auth owner disappeared or became unverified");
    if (m.evidence === "admin-verified-email") assertImportedUser(user, m.authMarker, m.email);
    else if (
      !providers.some(
        (p) =>
          p.user_id === m.subject &&
          p.provider === "google" &&
          String(p.subject) === m.googleProviderSubject,
      )
    )
      fail("Exact Google provider subject disappeared");
  }
}
function adminAdapter(sb) {
  return {
    listUsers: async () => {
      const users = [];
      for (let page = 1; ; page++) {
        const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 100 });
        if (error) fail("Auth inventory failed");
        users.push(...data.users);
        if (data.users.length < 100) {
          const detailed = await Promise.allSettled(
            users.map(async (user) => {
              const { data, error } = await sb.auth.admin.getUserById(user.id);
              if (error) fail("Detailed Auth inventory failed");
              return data.user;
            }),
          );
          for (const entry of detailed) if (entry.status === "rejected") throw entry.reason;
          return detailed.map((entry) => entry.value);
        }
      }
    },
    getUserById: async (id) => {
      const { data, error } = await sb.auth.admin.getUserById(id);
      if (error) fail("Auth receipt lookup failed");
      return data.user;
    },
    createUser: async (attributes) => {
      const { data, error } = await sb.auth.admin.createUser(attributes);
      if (error) fail("Auth creation failed; retry using durable intent/marker");
      return data.user;
    },
  };
}
export async function mutateRow(tx, change, reverse = false) {
  const before = reverse ? change.after : change.before,
    after = reverse ? change.before : change.after;
  const table = `bmai_qa.${tableName(change.table)}`;
  const keys = Object.entries(change.key);
  const args = keys.map(([, v]) => v);
  const where = keys.map(([k], i) => `${tableName(k)}=$${i + 1}`).join(" and ");
  const found = [...(await tx.unsafe(`select * from ${table} where ${where} for update`, args))];
  if (!equal(normalizeRow(change.table, found[0]), before))
    fail(`Changed ${change.table} during transaction`);
  if (after === null) {
    await tx.unsafe(`delete from ${table} where ${where}`, args);
    return;
  }
  const entries = Object.entries(after);
  const values = entries.map(([, v]) => v);
  if (before === null)
    await tx.unsafe(
      `insert into ${table} (${entries.map(([k]) => tableName(k)).join(",")}) values (${entries.map((_, i) => `$${i + 1}`).join(",")})`,
      values,
    );
  else
    await tx.unsafe(
      `update ${table} set ${entries.map(([k], i) => `${tableName(k)}=$${i + 1}`).join(",")} where ${keys.map(([k], i) => `${tableName(k)}=$${entries.length + i + 1}`).join(" and ")}`,
      [...values, ...args],
    );
}
export async function lockMaster(tx, plan) {
  await tx.unsafe("set local lock_timeout='10s'");
  await tx.unsafe("set local statement_timeout='60s'");
  for (const m of [...plan.mappings].sort((a, b) =>
    String(a.subject ?? a.accountId).localeCompare(String(b.subject ?? b.accountId)),
  ))
    await tx.unsafe("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `supabase:${m.subject ?? m.accountId}`,
    ]);
  await tx.unsafe(
    `lock table ${Object.keys(KEYS)
      .sort()
      .map((t) => "bmai_qa." + tableName(t))
      .join(",")} in share row exclusive mode`,
  );
}
async function withJournalLock(file, work) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  let fd;
  try {
    fd = fs.openSync(lock, "wx", 0o600);
  } catch {
    fail("Private journal locked; inspect interrupted process before retry");
  }
  try {
    return await work();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
export async function main(argv = process.argv.slice(2)) {
  const args = options(argv);
  if (args.help) {
    console.log(
      "Dry run: node scripts/legacy-master-import.mjs [--only=existing-provider-match] [--out=PRIVATE_DIR]\nApply/pause/rollback: --MODE --manifest=FILE --reviewed-digest=SHA256 --receipt=PRIVATE_FILE\nPause additionally requires --protection-evidence=PRIVATE_FILE --max-inflight-seconds=300. Apply requires --pause-receipt=FILE for any displaced tenant. No Auth users or databases are deleted.",
    );
    return;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const require = createRequire(path.join(root, "apps/web/package.json"));
  const postgres = require("postgres");
  const { createClient: libsql } = require("@libsql/client");
  const { createClient: sbClient } = require("@supabase/supabase-js");
  const env = envFile(args.env ?? path.join(root, ".env.supabase.production.local"));
  if (
    env.AUTH_PROVIDER !== "supabase" ||
    !env.SUPABASE_DATABASE_URL ||
    !env.SUPABASE_DATABASE_CA_BASE64 ||
    !env.SUPABASE_SECRET_KEY
  )
    fail("Explicit production Supabase environment required");
  const cipher = new CredentialCipher(env.MASTER_CREDENTIAL_ENCRYPTION_KEY);
  const keyFingerprint = digest(env.MASTER_CREDENTIAL_ENCRYPTION_KEY);
  const sql = postgres(env.SUPABASE_DATABASE_URL, {
    max: 1,
    prepare: false,
    ssl: {
      rejectUnauthorized: true,
      ca: Buffer.from(env.SUPABASE_DATABASE_CA_BASE64, "base64").toString("utf8"),
    },
  });
  const admin = adminAdapter(
    sbClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: boundedFetch },
    }),
  );
  const sourceDir = args["source-dir"] ?? path.join(root, ".work/master-migration-recon");
  const out = path.resolve(
    args.out ?? path.join(root, ".work/master-migration-import", `${Date.now()}-${randomUUID()}`),
  );
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  fs.chmodSync(out, 0o700);
  try {
    if (!["apply", "rollback", "pause", "pause-rollback", "resume-pause"].some((k) => args[k])) {
      const source = await snapshotLegacy(out, libsql);
      const clerk = await listClerk(envFile(path.join(sourceDir, "legacy-live-env.private")));
      const users = await admin.listUsers();
      const target = await sql.begin("isolation level repeatable read read only", readTarget);
      target.authProviders = providersFromUsers(users);
      const audits = [];
      for (const t of source.tables.tenants.rows)
        audits.push(await auditTenant(libsql, t, cipher, "legacy"));
      for (const t of target.tables.tenants ?? [])
        if (
          target.authProviders.some(
            (p) =>
              p.provider === "google" &&
              clerk.some((c) =>
                c.external_accounts?.some(
                  (e) =>
                    e.provider === "oauth_google" &&
                    String(e.provider_user_id) === String(p.subject),
                ),
              ) &&
              (target.tables.identities ?? []).some(
                (i) => i.subject === p.user_id && i.account_id === t.account_id,
              ),
          ) &&
          !target.tables.legacy_imports?.some((l) => l.account_id === t.account_id)
        )
          audits.push(await auditTenant(libsql, t, cipher, "displaced-current"));
      const pauseReceipt = args["pause-receipt"] ? readPrivate(args["pause-receipt"]) : null;
      const planningTarget = structuredClone(target);
      if (pauseReceipt)
        for (const p of pauseReceipt.pauses) {
          const actual = findRow(target, "tenants", { account_id: p.before.account_id });
          if (!equal(actual, { ...p.before, status: "disabled" })) fail("Pause route changed");
          planningTarget.tables.tenants = planningTarget.tables.tenants.map((t) =>
            t.account_id === p.before.account_id ? p.before : t,
          );
        }
      const plan = buildPlan({
        source,
        clerk,
        users,
        providers: target.authProviders,
        target: planningTarget,
        audits,
        cipher,
        keyFingerprint,
        only: args.only ?? "all",
      });
      const manifest = { plan, digest: digest(plan) };
      for (const [name, data] of Object.entries({
        "clerk-users": clerk,
        "supabase-users": users,
        "supabase-master-snapshot": target,
        "tenant-audit": audits,
      }))
        writePrivate(path.join(out, `${name}.private.json`), data);
      writePrivate(path.join(out, "manifest.private.json"), manifest);
      writePrivate(path.join(out, "backup-manifest.private.json"), {
        sourceDigest: plan.sourceDigest,
        files: fs
          .readdirSync(out)
          .filter((n) => n.endsWith(".private.json") || n.endsWith(".private.db"))
          .map((n) => ({
            file: n,
            sha256: createHash("sha256")
              .update(fs.readFileSync(path.join(out, n)))
              .digest("hex"),
          })),
      });
      console.log(
        JSON.stringify({
          mode: "dry-run",
          manifest: path.join(out, "manifest.private.json"),
          reviewedDigest: manifest.digest,
          selection: plan.selection,
          accounts: plan.mappings.length,
          preserveExisting: plan.mappings.filter((m) => m.evidence === "provider-subject").length,
          createDormant: plan.mappings.filter(
            (m) => m.evidence === "admin-verified-email" && !m.subject,
          ).length,
          changes: Object.fromEntries(
            Object.keys(KEYS).map((t) => [t, plan.changes.filter((c) => c.table === t).length]),
          ),
          archivedOnly: plan.archivedOnly,
          remoteMutations: 0,
        }),
      );
      return;
    }
    if (!args.manifest || !args.receipt || !sha.test(args["reviewed-digest"] ?? ""))
      fail("Mutation requires private manifest, receipt and reviewed digest");
    const manifest = readPrivate(args.manifest);
    const plan = manifest.plan;
    if (
      manifest.digest !== digest(plan) ||
      manifest.digest !== args["reviewed-digest"] ||
      plan.version !== 1 ||
      plan.keyFingerprint !== keyFingerprint
    )
      fail("Reviewed manifest/key digest mismatch");
    await withJournalLock(args.receipt, async () => {
      let journal = fs.existsSync(args.receipt)
        ? readPrivate(args.receipt)
        : {
            version: 1,
            manifestDigest: manifest.digest,
            sourceDigest: plan.sourceDigest,
            stage: "prepared",
            auth: {},
          };
      if (journal.manifestDigest !== manifest.digest)
        fail("Journal belongs to a different reviewed manifest");
      const save = async (j) => writePrivate(args.receipt, j);
      if (args.pause || args["pause-rollback"] || args["resume-pause"]) {
        if (args.pause || args["pause-rollback"]) {
          if (["paused", "pause-intent"].includes(journal.stage)) {
            const state = await sql.begin("isolation level repeatable read read only", readTarget);
            const disabled = journal.pauses.every((p) =>
              equal(findRow(state, "tenants", { account_id: p.before.account_id }), {
                ...p.before,
                status: "disabled",
              }),
            );
            if (disabled) {
              if (journal.stage === "pause-intent") {
                journal.stage = "paused";
                journal.committedAt = new Date().toISOString();
                await save(journal);
              }
              console.log(
                JSON.stringify({
                  mode: "pause",
                  alreadyPaused: true,
                  receipt: args.receipt,
                  drainUntil: new Date(
                    Date.parse(journal.committedAt) + (journal.maxInflightSeconds + 30) * 1000,
                  ).toISOString(),
                }),
              );
              return;
            }
            if (journal.stage === "paused") fail("Paused route changed");
          }
          if (!args["protection-evidence"] || Number(args["max-inflight-seconds"]) < 300)
            fail("Pause needs verified deployment protection and maximum inflight bound >=300s");
          const evidence = readPrivate(args["protection-evidence"]);
          if (
            !evidence.oldDeploymentsProtected ||
            !evidence.tenantCredentialWritersIdle ||
            !evidence.timeoutBoundVerified ||
            Number(evidence.maxInflightSeconds) !== Number(args["max-inflight-seconds"])
          )
            fail("Incomplete writer protection evidence");
          let pausePlan = plan;
          if (args["pause-rollback"]) {
            if (!args["import-receipt"])
              fail("Rollback pause needs applied private import receipt");
            const imported = readPrivate(args["import-receipt"]);
            if (imported.manifestDigest !== manifest.digest || imported.stage !== "applied")
              fail("Rollback pause import receipt conflict");
            pausePlan = resolveSubjects(plan, imported.subjects);
            pausePlan.changes = imported.changes;
            await sql.begin("isolation level repeatable read read only", async (tx) =>
              assertAfterImages(imported.changes, await readTarget(tx)),
            );
          }
          const pauses = pausePlan.changes
            .filter((c) => c.table === "tenants" && (args["pause-rollback"] ? c.after : c.before))
            .map((c) => ({ before: args["pause-rollback"] ? c.after : c.before }));
          if (!pauses.length) fail("No displaced tenant to pause");
          journal = {
            ...journal,
            stage: "pause-intent",
            pauses,
            externalWritersBlocked: true,
            protectionEvidence: digest(evidence),
            maxInflightSeconds: Number(args["max-inflight-seconds"]),
          };
          await save(journal);
          await sql.begin(async (tx) => {
            await lockMaster(tx, plan);
            const target = await readTarget(tx);
            if (args["pause-rollback"]) assertAfterImages(pausePlan.changes, target);
            else assertBeforeImages(plan, target);
            writePrivate(path.join(out, "target-before-pause.private.json"), target);
            for (const p of pauses)
              await mutateRow(tx, {
                table: "tenants",
                key: { account_id: p.before.account_id },
                before: p.before,
                after: { ...p.before, status: "disabled" },
              });
          });
          journal.stage = "paused";
          journal.committedAt = new Date().toISOString();
          await save(journal);
          console.log(
            JSON.stringify({
              mode: "pause",
              receipt: args.receipt,
              drainUntil: new Date(
                Date.parse(journal.committedAt) + (journal.maxInflightSeconds + 30) * 1000,
              ).toISOString(),
            }),
          );
          return;
        }
        if (!["paused", "pause-intent"].includes(journal.stage))
          fail("Pause cannot be resumed in current stage");
        await sql.begin(async (tx) => {
          await lockMaster(tx, plan);
          for (const p of journal.pauses)
            await mutateRow(tx, {
              table: "tenants",
              key: { account_id: p.before.account_id },
              before: { ...p.before, status: "disabled" },
              after: p.before,
            });
        });
        journal.stage = "pause-resumed";
        await save(journal);
        console.log(JSON.stringify({ mode: "resume-pause", restored: journal.pauses.length }));
        return;
      }
      const freshSource = await snapshotLegacy(out, libsql);
      if (canonicalSourceDigest(freshSource) !== plan.sourceDigest)
        fail("Legacy source changed; new reviewed dry run required");
      const audits = [];
      for (const m of plan.mappings) {
        const t = freshSource.tables.tenants.rows.find((t) => t.clerk_user_id === m.clerkSubject);
        audits.push(await auditTenant(libsql, t, cipher, "legacy"));
        if (audits.at(-1).contentDigest !== m.legacyContentDigest)
          fail("Legacy tenant content changed; guarded operation refused");
      }
      if (args.rollback) {
        if (!journal.changes || !["applied", "master-intent"].includes(journal.stage))
          fail("No durable import transaction receipt");
        const resolved = resolveSubjects(plan, journal.subjects);
        const rollbackPause = args["pause-receipt"] ? readPrivate(args["pause-receipt"]) : null;
        const rollbackPlan = {
          ...plan,
          changes: journal.changes
            .filter((c) => c.table === "tenants")
            .map((c) => ({ ...c, before: c.after })),
        };
        assertPauseReceipt(rollbackPlan, rollbackPause);
        await sql.begin(async (tx) => {
          await lockMaster(tx, resolved);
          const target = await readTarget(tx);
          const virtual = structuredClone(target);
          for (const p of rollbackPause?.pauses ?? []) {
            if (
              !equal(findRow(target, "tenants", { account_id: p.before.account_id }), {
                ...p.before,
                status: "disabled",
              })
            )
              fail("Rollback pause changed");
            virtual.tables.tenants = virtual.tables.tenants.map((t) =>
              t.account_id === p.before.account_id ? p.before : t,
            );
          }
          assertAfterImages(journal.changes, virtual);
          if (!journal.rollbackState) fail("Missing durable rollback baseline");
          assertRollbackState(journal.rollbackState, virtual);
          for (const c of [...journal.changes].reverse()) {
            const paused =
              c.table === "tenants" && rollbackPause?.pauses.some((p) => equal(p.before, c.after));
            await mutateRow(
              tx,
              paused ? { ...c, after: { ...c.after, status: "disabled" } } : c,
              true,
            );
          }
        });
        journal.stage = "rolled-back";
        journal.retainedAuthSubjects = Object.values(journal.auth)
          .map((a) => a.subject)
          .filter(Boolean);
        await save(journal);
        console.log(
          JSON.stringify({
            mode: "rollback",
            restored: journal.changes.length,
            retainedAuthUsers: journal.retainedAuthSubjects.length,
            deletedDatabases: 0,
          }),
        );
        return;
      }
      const pauseReceipt = args["pause-receipt"] ? readPrivate(args["pause-receipt"]) : null;
      assertPauseReceipt(plan, pauseReceipt);
      const target = await sql.begin("isolation level repeatable read read only", readTarget);
      if (journal.stage === "applied") {
        assertAfterImages(journal.changes, target);
        console.log(JSON.stringify({ mode: "apply", alreadyApplied: true, receipt: args.receipt }));
        return;
      }
      if (journal.stage === "master-intent" && journal.changes) {
        try {
          assertAfterImages(journal.changes, target);
          journal.stage = "applied";
          await save(journal);
          console.log(
            JSON.stringify({
              mode: "apply",
              recoveredCommittedTransaction: true,
              receipt: args.receipt,
            }),
          );
          return;
        } catch {
          /* Full before-image validation below refuses mixed/unrelated state. */
        }
      }
      assertBeforeImages(plan, target, { pauseReceipt });
      for (const c of plan.changes.filter((c) => c.table === "tenants" && c.before)) {
        const a = await auditTenant(libsql, c.before, cipher, "displaced-current");
        assertEmptyTenant(a);
        const m = plan.mappings.find((m) => m.accountId === c.key.account_id);
        if (a.contentDigest !== m.displacedContentDigest)
          fail("Displaced tenant changed after dry run");
      }
      const clerk = await listClerk(envFile(path.join(sourceDir, "legacy-live-env.private")));
      const currentUsers = await admin.listUsers();
      const currentProviders = providersFromUsers(currentUsers);
      for (const m of plan.mappings) {
        const old = clerk.find((u) => u.id === m.clerkSubject);
        const primary = old?.email_addresses?.find((e) => e.id === old.primary_email_address_id);
        if (
          primary?.verification?.status !== "verified" ||
          normEmail(primary.email_address) !== m.email ||
          old.banned ||
          old.locked
        )
          fail("Authoritative identity changed");
        if (
          m.evidence === "provider-subject" &&
          (!currentUsers.some((u) => u.id === m.subject && u.email_confirmed_at) ||
            !currentProviders.some(
              (p) =>
                p.user_id === m.subject &&
                p.provider === "google" &&
                old.external_accounts?.some(
                  (e) =>
                    e.provider === "oauth_google" &&
                    String(e.provider_user_id) === String(p.subject),
                ),
            ))
        )
          fail("Exact provider identity changed");
      }
      writePrivate(path.join(out, "target-before-auth.private.json"), target);
      writePrivate(path.join(out, "clerk-before-auth.private.json"), clerk);
      writePrivate(path.join(out, "auth-before-auth.private.json"), currentUsers);
      const subjects = await ensureAuthUsers(plan, admin, journal, save);
      const resolved = resolveSubjects(plan, subjects);
      const finalAuthDetails = await Promise.allSettled(
        resolved.mappings.map((m) => admin.getUserById(m.subject)),
      );
      for (const entry of finalAuthDetails) if (entry.status === "rejected") throw entry.reason;
      assertAuthSnapshot(
        resolved,
        finalAuthDetails.map((entry) => entry.value),
      );
      writePrivate(path.join(out, "auth-final-proof.private.json"), {
        verifiedAt: new Date().toISOString(),
        users: finalAuthDetails.map((entry) => entry.value),
        boundary:
          "Supported admin API proof immediately before transaction; restricted-role canonical identity/route CAS is atomic. No auth-table grant or lock.",
      });
      journal.subjects = subjects;
      journal.changes = resolved.changes;
      journal.stage = "master-intent";
      await save(journal);
      await sql.begin(async (tx) => {
        await lockMaster(tx, resolved);
        const current = await readTarget(tx);
        if (
          !current.schema.some(
            (c) => c.table_name === "usage" && c.column_name === "newtab_templates",
          ) ||
          !current.tables.legacy_imports
        )
          fail("Reviewed import schema not installed");
        assertBeforeImages(resolved, current, { pauseReceipt });
        // Auth proof uses the supported admin API immediately before this transaction.
        // FK integrity plus canonical identity CAS protects the target binding; the
        // restricted application role deliberately has no auth-table inspection grant.
        for (const c of resolved.changes) {
          let before = c.before;
          if (c.table === "tenants" && before && pauseReceipt)
            before = { ...before, status: "disabled" };
          await mutateRow(tx, { ...c, before });
        }
        const after = await readTarget(tx);
        journal.rollbackState = rollbackState(resolved, after);
        await save(journal);
      });
      journal.stage = "applied";
      journal.appliedAt = new Date().toISOString();
      await save(journal);
      console.log(
        JSON.stringify({
          mode: "apply",
          receipt: args.receipt,
          accounts: resolved.mappings.length,
          changes: resolved.changes.length,
          createdAuthUsers: Object.values(journal.auth).filter((a) => a.stage === "created").length,
          deletedDatabases: 0,
        }),
      );
    });
  } finally {
    await sql.end();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(
      JSON.stringify({
        error:
          error instanceof ImportRefusal
            ? error.message
            : "Import failed; private inputs and credentials were not printed",
        code: /^[A-Z0-9_]+$/.test(String(error?.code)) ? error.code : undefined,
      }),
    );
    process.exitCode = 1;
  });
