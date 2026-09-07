#!/usr/bin/env node
/**
 * Store packaging — turns the zips `pnpm zip` / `pnpm zip:firefox` already
 * wrote into `.output/` into the two archives the stores actually take on a
 * first submission. Dependency-free (node:crypto + the system `zip`/`unzip`).
 *
 *   node scripts/store-zip.mjs [--chrome-only | --sources-only]
 *
 * 1. `<name>-<version>-chrome-store.zip`  (Chrome Web Store, FIRST upload only)
 *    The chrome zip with the manifest `key` REMOVED and the private key added as
 *    `key.pem` at the zip root, which is how the CWS keeps the pinned id
 *    ffhbgpgebpmofjkehpjcemepbgcmoelp (Clerk allowed_origins + authorized-parties
 *    depend on it). Aborts unless `.keys/crx-key.pem` exists AND derives exactly
 *    that id (id = sha256(SubjectPublicKeyInfo DER)[:32 hex] mapped 0-f → a-p).
 *    Later store updates use the plain chrome zip (CI already does).
 *
 * 2. `<name>-<version>-sources.zip`  (AMO source-code upload)
 *    AMO requires the source of bundled/minified add-ons plus build steps. WXT's
 *    own sources zip holds only apps/extension (no packages/types, no lockfile),
 *    so it cannot be rebuilt; this one carries everything a reviewer needs to
 *    reproduce `.output/firefox-mv2` byte-for-byte, with a generated BUILD.md.
 *    NEVER contains .keys/, *.pem, .env or .env.local (asserted before zipping).
 */
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(EXT_DIR, "../..");
const OUT_DIR = path.join(EXT_DIR, ".output");
const PEM_PATH = path.join(EXT_DIR, ".keys", "crx-key.pem");
const FIREFOX_OUT_DIR = path.join(OUT_DIR, "firefox-mv2");

/** The production CRX id — mirrors CLAUDE.md → "Stable extension ids". */
const EXPECTED_CRX_ID = "ffhbgpgebpmofjkehpjcemepbgcmoelp";
/** Mirrors `PROD_HOST_PERMISSIONS` in lib/app-origins.ts (the unit test pins
 * the TS side; this pins the built artifact that is about to be uploaded). */
const EXPECTED_PROD_HOSTS = [
  "https://bookmark-ai.cloud/*",
  "https://www.bookmark-ai.cloud/*",
  "https://clerk.bookmark-ai.cloud/*",
  "https://live.bookmark-ai.cloud/*",
];
/** Toolchain the reviewer must match — keep in lock-step with
 * .github/workflows/extension-release.yml + the root package.json. */
const NODE_LINE = "22";
const PNPM_VERSION = "10.34.1";

const pkg = JSON.parse(readFileSync(path.join(EXT_DIR, "package.json"), "utf8"));
/** WXT's `safeFilename` for the `{{name}}` template — "@bookmark-ai/extension" → "bookmark-aiextension". */
const artifactName = pkg.name.toLowerCase().replace(/[^a-z0-9-\s]/g, "").replace(/\s+/g, "-");
const VERSION = pkg.version;
const CHROME_ZIP = path.join(OUT_DIR, `${artifactName}-${VERSION}-chrome.zip`);
const FIREFOX_ZIP = path.join(OUT_DIR, `${artifactName}-${VERSION}-firefox.zip`);
const STORE_ZIP = path.join(OUT_DIR, `${artifactName}-${VERSION}-chrome-store.zip`);
const SOURCES_ZIP = path.join(OUT_DIR, `${artifactName}-${VERSION}-sources.zip`);

const args = new Set(process.argv.slice(2));
const doChrome = !args.has("--sources-only");
const doSources = !args.has("--chrome-only");

function fail(msg) {
  console.error(`\n[store-zip] ERROR: ${msg}\n`);
  process.exit(1);
}
function log(msg) {
  console.log(`[store-zip] ${msg}`);
}
function run(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, { stdio: ["pipe", "pipe", "inherit"], ...opts });
}
function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function sizeOf(file) {
  const kb = statSync(file).size / 1024;
  return kb > 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb.toFixed(0)} KB`;
}
/** Chrome extension id of a public key given as SubjectPublicKeyInfo DER. */
function crxIdFromSpkiDer(der) {
  return sha256(der)
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16)));
}

// ---------------------------------------------------------------------------
// 1. Chrome Web Store first-upload zip (key removed, key.pem at the root)
// ---------------------------------------------------------------------------
function buildChromeStoreZip() {
  if (!existsSync(CHROME_ZIP)) fail(`${CHROME_ZIP} not found — run \`pnpm zip\` first.`);
  if (!existsSync(PEM_PATH)) {
    fail(
      `${PEM_PATH} is missing. The CWS first upload needs the PRIVATE half of the pinned ` +
        `prod CRX key to keep id ${EXPECTED_CRX_ID}. It is gitignored on purpose — restore it ` +
        `from the secure backup; never regenerate it (a new key = a new id = broken auth).`,
    );
  }

  const pem = readFileSync(PEM_PATH);
  let spkiDer;
  try {
    spkiDer = createPublicKey(pem).export({ type: "spki", format: "der" });
  } catch (err) {
    fail(`${PEM_PATH} is not a readable private key: ${err.message}`);
  }
  const pemId = crxIdFromSpkiDer(spkiDer);
  if (pemId !== EXPECTED_CRX_ID) {
    fail(`.keys/crx-key.pem derives id ${pemId}, expected ${EXPECTED_CRX_ID} — wrong key file.`);
  }
  log(`key.pem verified → id ${pemId}`);

  const work = mkdtempSync(path.join(tmpdir(), "bookmark-ai-store-"));
  try {
    run("unzip", ["-q", CHROME_ZIP, "-d", work]);
    const manifestPath = path.join(work, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    if (manifest.version !== VERSION) {
      fail(`chrome zip manifest version ${manifest.version} ≠ package.json ${VERSION} — rebuild (\`pnpm zip\`).`);
    }
    if (!manifest.key) fail("chrome zip manifest has no `key` — is this a production build?");
    const manifestId = crxIdFromSpkiDer(Buffer.from(manifest.key, "base64"));
    if (manifestId !== EXPECTED_CRX_ID) {
      fail(`manifest key derives id ${manifestId}, expected ${EXPECTED_CRX_ID} — not the prod target.`);
    }
    const hosts = manifest.host_permissions ?? [];
    if (JSON.stringify(hosts) !== JSON.stringify(EXPECTED_PROD_HOSTS)) {
      fail(
        `chrome zip host_permissions are not the four production origins:\n  ${JSON.stringify(hosts)}\n` +
          `Expected: ${JSON.stringify(EXPECTED_PROD_HOSTS)} — was this built in production mode?`,
      );
    }

    delete manifest.key;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    copyFileSync(PEM_PATH, path.join(work, "key.pem"));

    rmSync(STORE_ZIP, { force: true });
    run("zip", ["-q", "-X", "-r", STORE_ZIP, "."], { cwd: work });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  // Re-read the artifact itself, never trust the staging dir.
  const listing = run("unzip", ["-Z1", STORE_ZIP]).toString().trim().split("\n");
  if (!listing.includes("key.pem")) fail("key.pem is not at the root of the store zip.");
  const shipped = JSON.parse(run("unzip", ["-p", STORE_ZIP, "manifest.json"]).toString());
  if ("key" in shipped) fail("manifest.json inside the store zip still carries `key`.");

  log(`wrote ${path.relative(REPO_ROOT, STORE_ZIP)} (${sizeOf(STORE_ZIP)}, ${listing.length} files)`);
  log(`  manifest: version ${shipped.version}, key: absent, host_permissions: ${JSON.stringify(shipped.host_permissions)}`);
  console.log(
    "\n[store-zip] REMINDER: the *-chrome-store.zip is for the FIRST Chrome Web Store upload ONLY\n" +
      "            (\"Add new item\") — key.pem tells the store to keep id " + EXPECTED_CRX_ID + ".\n" +
      "            Every later update uploads the plain *-chrome.zip (CI's publish job already does).\n" +
      "            Verify the item id in the dashboard URL after the upload.\n",
  );
}

// ---------------------------------------------------------------------------
// 2. AMO sources zip (everything needed to rebuild firefox-mv2) + BUILD.md
// ---------------------------------------------------------------------------

/** Directory / file names dropped wherever they appear under a collected tree. */
const ALWAYS_SKIP = new Set([".output", "node_modules", ".wxt", ".keys", ".turbo", "dist", ".DS_Store"]);
/** Extra skips under apps/extension only. */
const EXTENSION_SKIP = new Set([
  "store-assets", // listing screenshots, not source
  "safari-xcode", // generated Xcode wrapper (gitignored)
  "Bookmark AI", // stray safari-web-extension-converter output (gitignored)
]);
function isPrivateEnv(name) {
  // Keep the committed per-target files (.env.production/.env.development/
  // .env.dev-remote/.env.example) — the build reads them. Drop private overrides.
  return name === ".env" || name === ".env.local" || /^\.env\..*\.local$/.test(name);
}

/** Recursively list files under `absDir`, returned as repo-relative POSIX paths. */
function collect(absDir, extraSkip = new Set()) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (ALWAYS_SKIP.has(name) || extraSkip.has(name)) continue;
      if (name.endsWith(".log") || name.endsWith(".pem") || isPrivateEnv(name)) continue;
      const abs = path.join(dir, name);
      if (entry.isSymbolicLink()) continue; // workspace links live in node_modules only; be safe
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(path.relative(REPO_ROOT, abs).split(path.sep).join("/"));
    }
  };
  walk(absDir);
  return out;
}

function firefoxOutputTable() {
  if (!existsSync(FIREFOX_OUT_DIR)) {
    return "_(`.output/firefox-mv2` was not present when this archive was generated — run `pnpm zip:firefox` first to embed the file list.)_";
  }
  const files = collect(FIREFOX_OUT_DIR).map((rel) => rel.replace(/^apps\/extension\/\.output\/firefox-mv2\//, ""));
  // `collect` skips `.output` at the top level only when walking INTO it from
  // its parent; here we start inside it, so nothing is filtered.
  const rows = files
    .sort()
    .map((rel) => {
      const abs = path.join(FIREFOX_OUT_DIR, rel);
      return `| \`${rel}\` | ${statSync(abs).size} | \`${sha256(readFileSync(abs))}\` |`;
    });
  return ["| File | Bytes | SHA-256 |", "| --- | ---: | --- |", ...rows].join("\n");
}

function buildMd() {
  const firefoxZipName = path.basename(FIREFOX_ZIP);
  return `# Building Bookmark AI (Firefox add-on \`bookmark-ai@purecode.ai\`) v${VERSION} from source

This archive is the complete, self-contained source for the add-on package uploaded to
addons.mozilla.org. It is a trimmed copy of the open-source monorepo
(https://github.com/Tarachand-Gupta/bookmark-ai): the extension app, its only workspace
dependency (\`packages/types\`, the shared Zod API contract), and the root workspace
files (\`package.json\`, \`pnpm-workspace.yaml\`, \`pnpm-lock.yaml\`, \`tsconfig.base.json\`).
Everything else in the archive is referenced by the lockfile and comes from the public
npm registry, unmodified. No code is fetched at runtime; there is no \`eval\`/remote script.

## Toolchain (the exact versions our CI pins in \`.github/workflows/extension-release.yml\`)

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | **${NODE_LINE}.x** (LTS) | \`node --version\` → v${NODE_LINE}.* |
| pnpm | **${PNPM_VERSION}** | pinned via \`"packageManager"\` in the root \`package.json\` |
| OS | any (built/verified on macOS; CI is ubuntu-latest) | no native toolchain needed — esbuild/tailwind binaries come from npm |

Install pnpm at exactly that version, either through corepack (bundled with Node):

\`\`\`sh
corepack enable
corepack prepare pnpm@${PNPM_VERSION} --activate
\`\`\`

or globally: \`npm install -g pnpm@${PNPM_VERSION}\`.

## Build steps (run from the directory this archive was extracted into)

\`\`\`sh
# 1. Install the extension and its workspace dependency, exactly as locked.
#    (postinstall runs \`wxt prepare\` through apps/extension/scripts/wxt-run.mjs)
pnpm --filter @bookmark-ai/extension... install --frozen-lockfile

# 2. Build the Firefox (Manifest V2) target in production mode.
pnpm --filter @bookmark-ai/extension build:firefox
#    → apps/extension/.output/firefox-mv2/

# 3. (optional) Produce the same zip we uploaded:
pnpm --filter @bookmark-ai/extension zip:firefox
#    → apps/extension/.output/${firefoxZipName}
\`\`\`

\`build:firefox\` is \`node ./scripts/wxt-run.mjs build -b firefox\` — a thin watchdog around
\`wxt build -b firefox\` (WXT ${pkg.devDependencies?.wxt ?? "0.20.x"}, Vite + esbuild + Rollup; React 19; Tailwind v4). WXT
runs in \`production\` mode, which reads the committed, public build-time settings in
\`apps/extension/.env.production\` (app origin, Clerk publishable key, live server URL) and
inlines them as \`import.meta.env.WXT_*\`.

## What the uploaded XPI is

The XPI/zip is exactly the contents of \`apps/extension/.output/firefox-mv2/\`. Source → output:

| Output file | Built from |
| --- | --- |
| \`manifest.json\` | \`apps/extension/wxt.config.ts\` (\`manifest\` function, \`browser === "firefox"\`, MV2) |
| \`background.js\` | \`apps/extension/entrypoints/background.ts\` + \`apps/extension/lib/**\` + \`packages/types/src/**\` |
| \`popup.html\`, \`chunks/popup-*.js\`, \`assets/popup-*.css\` | \`apps/extension/entrypoints/popup/**\` (React) + \`apps/extension/assets/tailwind.css\` |
| \`content-scripts/marker.js\` | \`apps/extension/entrypoints/marker.content.ts\` + \`lib/extension-marker.ts\` + \`lib/app-origins.ts\` |
| \`icon/\`, \`icon-dev/\`, \`icon-local/\` | static copies of \`apps/extension/public/**\` |

(\`entrypoints/bridge.content.ts\` is Safari-only and is excluded from the Firefox build.)
Chunk names carry a Rollup content hash, so identical inputs yield identical names.

### Files in the uploaded package (as built when this archive was generated)

${firefoxOutputTable()}

## Third-party code (all unmodified, from the lockfile)

Runtime: \`react\`, \`react-dom\`, \`@clerk/chrome-extension\` (session mirroring), \`zod\`
(via \`packages/types\`), plus WXT's small runtime helpers (\`wxt/browser\`, \`@wxt-dev/storage\`).
Build-time only: \`wxt\`, \`vite\`, \`@wxt-dev/module-react\`, \`tailwindcss\` + \`@tailwindcss/vite\`,
\`typescript\`, \`vitest\`.

## Contact

Tara — tara@purecode.ai · https://www.bookmark-ai.cloud
`;
}

function buildSourcesZip() {
  const files = [
    ...collect(path.join(EXT_DIR), EXTENSION_SKIP),
    ...collect(path.join(REPO_ROOT, "packages", "types")),
    ...["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "tsconfig.base.json", ".npmrc"].filter((f) =>
      existsSync(path.join(REPO_ROOT, f)),
    ),
  ].sort();

  for (const f of files) {
    if (/(^|\/)\.keys(\/|$)/.test(f) || /\.pem$/i.test(f) || /(^|\/)\.env(\.local)?$/.test(f) || /(^|\/)node_modules(\/|$)/.test(f)) {
      fail(`refusing to package ${f} into the sources zip.`);
    }
  }
  for (const required of ["pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "tsconfig.base.json",
    "apps/extension/package.json", "apps/extension/wxt.config.ts", "apps/extension/.env.production",
    "apps/extension/scripts/wxt-run.mjs", "packages/types/package.json", "packages/types/src/index.ts"]) {
    if (!files.includes(required)) fail(`sources zip would be missing ${required}.`);
  }

  const staging = mkdtempSync(path.join(tmpdir(), "bookmark-ai-sources-"));
  try {
    writeFileSync(path.join(staging, "BUILD.md"), buildMd());
    rmSync(SOURCES_ZIP, { force: true });
    // `-@` reads the file list from stdin; `-X` drops OS extra fields. Paths are
    // relative to the repo root so the zip unpacks as a mini monorepo.
    run("zip", ["-q", "-X", SOURCES_ZIP, "-@"], { cwd: REPO_ROOT, input: files.join("\n") + "\n" });
    run("zip", ["-q", "-X", "-j", SOURCES_ZIP, path.join(staging, "BUILD.md")]);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  const listing = run("unzip", ["-Z1", SOURCES_ZIP]).toString().trim().split("\n");
  if (!listing.includes("BUILD.md")) fail("BUILD.md missing from the sources zip root.");
  const leaked = listing.filter((f) => /\.pem$|(^|\/)\.keys\/|(^|\/)\.env(\.local)?$/.test(f));
  if (leaked.length) fail(`sources zip leaked secrets: ${leaked.join(", ")}`);

  log(`wrote ${path.relative(REPO_ROOT, SOURCES_ZIP)} (${sizeOf(SOURCES_ZIP)}, ${listing.length} files incl. BUILD.md)`);
  log("  upload it on AMO under \"Source code\" alongside " + path.basename(FIREFOX_ZIP) + "; reviewers follow BUILD.md.");
}

if (doChrome) buildChromeStoreZip();
if (doSources) buildSourcesZip();
