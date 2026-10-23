#!/usr/bin/env node
/** Live model transport over the isolated local preview. Never loads production DB/auth credentials. */
import { readFileSync, writeFileSync, existsSync, realpathSync, cpSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { parseEnv } from "./supabase-qa.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preview = resolve(root, process.argv[2] || ".work/release-1/web-fixture");
if (
  !existsSync(preview) ||
  !realpathSync(preview).startsWith(realpathSync(join(root, ".work")) + "/")
)
  throw new Error("An existing isolated .work preview is required.");
const app = join(preview, "apps/web");
if (!existsSync(join(preview, "fixture-data/fixture-a.db")))
  throw new Error(
    "An existing local fixture library is required; no accounts or data will be created.",
  );
// Refuse to change the preview underneath another running server.
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", () =>
    reject(new Error("Port 3000 is occupied. Stop that preview before restarting.")),
  );
  probe.listen(3000, "127.0.0.1", () => probe.close(resolve));
});
const boundaries = ["lib/auth.tsx", "lib/server/require-user.ts", "middleware.ts"];
const fixtureFiles = boundaries.map((path) => [path, readFileSync(join(app, path), "utf8")]);
if (!fixtureFiles[1][1].includes('"fixture-a"'))
  throw new Error("Expected isolated fixture authentication, not a deployed app.");
const ignored =
  /(?:^|\/)(?:node_modules|\.next[^/]*|\.env[^/]*|\.git|\.work|\.turbo|build|dist|data)(?:\/|$)|\.(?:db|log)(?:$|[-.])/;
for (const path of [
  "apps/web",
  "packages/db",
  "packages/engine",
  "packages/types",
  "packages/ui",
  "packages/server-logging",
])
  cpSync(join(root, path), join(preview, path), {
    recursive: true,
    filter: (source) => !ignored.test(source.slice(root.length + 1)),
  });
for (const [path, source] of fixtureFiles) writeFileSync(join(app, path), source);
const contextPath = join(app, "lib/server/context.ts");
const tenantFunction = "export async function getTenantDb(userId: string): Promise<TenantDb> {";
const context = readFileSync(contextPath, "utf8");
if (context.split(tenantFunction).length !== 2)
  throw new Error("Tenant adapter changed; review the fixture boundary.");
writeFileSync(
  contextPath,
  context.replace(
    tenantFunction,
    tenantFunction +
      `
  if (!/^fixture-[abcde]$/.test(userId)) throw new Error("Fixture identity required");
  store.__bookmarkTenantDbs ??= new Map();
  const cached = store.__bookmarkTenantDbs.get(userId);
  if (cached) return cached;
  const db = createDb("file:" + process.env.FIXTURE_DATA_DIR + "/" + userId + ".db");
  const fixture = { db, ready: ensureSchema(db) };
  store.__bookmarkTenantDbs.set(userId, fixture);
  return fixture;
`,
  ),
);
const configPath = join(app, "next.config.ts");
writeFileSync(
  configPath,
  readFileSync(configPath, "utf8").replace(
    "const nextConfig: NextConfig = {",
    "const nextConfig: NextConfig = {\n  devIndicators: false,",
  ),
);
const same = (path) =>
  createHash("sha256")
    .update(readFileSync(join(root, path)))
    .digest("hex") ===
  createHash("sha256")
    .update(readFileSync(join(preview, path)))
    .digest("hex");
for (const path of [
  "apps/web/app/api/chat/route.ts",
  "apps/web/lib/chat-workspace.ts",
  "apps/web/components/library/ai-chat.tsx",
]) {
  if (!same(path))
    throw new Error(
      `Preview source is stale: ${path}. Refresh the isolated preview before starting live AI.`,
    );
}
if (
  !readFileSync(join(app, "lib/server/context.ts"), "utf8").includes("process.env.FIXTURE_DATA_DIR")
)
  throw new Error("Preview must route test accounts to local fixture data.");
if (
  existsSync(join(preview, ".env")) ||
  [".env", ".env.local", ".env.development", ".env.development.local"].some((name) =>
    existsSync(join(app, name)),
  )
)
  throw new Error(
    "Preview env files must be removed or reviewed; this launcher supplies only AI keys.",
  );
const env = {};
for (const key of [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "NODE_EXTRA_CA_CERTS",
])
  if (process.env[key]) env[key] = process.env[key];
const aiKeys = [
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "INCLUDED_AI_PROVIDER",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
];
for (const file of [".env", ".env.supabase.production.local"]) {
  if (!existsSync(join(root, file))) continue;
  const selected = readFileSync(join(root, file), "utf8")
    .split("\n")
    .filter((line) => aiKeys.includes(line.match(/^\s*([A-Z_]+)\s*=/)?.[1]))
    .join("\n");
  const values = parseEnv(selected);
  for (const key of aiKeys) if (values[key]) env[key] = values[key];
}
if (!env.GEMINI_API_KEY && !env.OPENROUTER_API_KEY && !env.CLOUDFLARE_API_TOKEN)
  throw new Error(
    "No live AI credentials configured. Set server AI keys in an ignored root env file.",
  );
Object.assign(env, {
  FIXTURE_DATA_DIR: join(preview, "fixture-data"),
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_API_URL: "",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
});
console.log(
  "Local preview: http://localhost:3000 — LIVE AI provider, local test library. Production database/auth credentials are excluded.",
);
const child = spawn(
  process.execPath,
  [
    join(root, "apps/web/node_modules/next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3000",
  ],
  { cwd: app, env, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 130 : (code ?? 1);
});
