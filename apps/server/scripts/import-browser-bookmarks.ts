/**
 * Import existing Chrome/Safari bookmarks into Bookmark AI via the running API,
 * so every import goes through the full pipeline (OG scrape → AI categorize/tag
 * → embed worker).
 *
 * Usage (from apps/server, with the API running):
 *   pnpm tsx scripts/import-browser-bookmarks.ts                  # dry run (default)
 *   pnpm tsx scripts/import-browser-bookmarks.ts --apply          # actually import
 *   pnpm tsx scripts/import-browser-bookmarks.ts --source=chrome  # chrome|safari|all
 *   pnpm tsx scripts/import-browser-bookmarks.ts --apply --limit=50
 *
 * Safari needs Full Disk Access for your terminal; without it Safari is skipped
 * with a warning. Already-saved URLs are skipped (the library dedupes by URL).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = process.env.BOOKMARK_API_URL ?? "http://localhost:4000";

const args = new Map<string, string>(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const APPLY = args.get("apply") === "true";
const SOURCE = args.get("source") ?? "all";
const LIMIT = Number(args.get("limit") ?? Infinity);

interface FoundBookmark {
  url: string;
  title: string;
  folder: string;
  browser: "chrome" | "safari";
}

function chromeBookmarks(): FoundBookmark[] {
  const base = join(homedir(), "Library/Application Support/Google/Chrome");
  const out: FoundBookmark[] = [];
  if (!existsSync(base)) return out;
  for (const profile of readdirSync(base)) {
    const file = join(base, profile, "Bookmarks");
    if (!existsSync(file)) continue;
    let data: { roots?: Record<string, unknown> };
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const walk = (node: any, path: string): void => {
      if (!node) return;
      if (node.type === "url" && /^https?:/i.test(node.url ?? "")) {
        out.push({ url: node.url, title: node.name ?? node.url, folder: path, browser: "chrome" });
      }
      for (const child of node.children ?? []) {
        walk(child, node.name ? `${path}/${node.name}` : path);
      }
    };
    for (const root of Object.values(data.roots ?? {})) walk(root, profile);
  }
  return out;
}

function safariBookmarks(): FoundBookmark[] {
  const file = join(homedir(), "Library/Safari/Bookmarks.plist");
  let json: string;
  try {
    json = execFileSync("plutil", ["-convert", "json", "-o", "-", file], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    console.warn(
      "[import] Safari bookmarks unreadable (grant your terminal Full Disk Access to include them) — skipping",
    );
    return [];
  }
  const out: FoundBookmark[] = [];
  const walk = (node: any, path: string): void => {
    if (!node) return;
    if (node.WebBookmarkType === "WebBookmarkTypeLeaf" && /^https?:/i.test(node.URLString ?? "")) {
      out.push({
        url: node.URLString,
        title: node.URIDictionary?.title ?? node.URLString,
        folder: path,
        browser: "safari",
      });
    }
    for (const child of node.Children ?? []) {
      walk(child, node.Title ? `${path}/${node.Title}` : path);
    }
  };
  walk(JSON.parse(json), "Safari");
  return out;
}

async function libraryUrls(): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let offset = 0; ; offset += 200) {
    const res = await fetch(`${API}/api/bookmarks?limit=200&offset=${offset}`);
    if (!res.ok) throw new Error(`API unreachable (${res.status}) — is the server running on ${API}?`);
    const data = (await res.json()) as { bookmarks: { url: string }[]; total: number };
    for (const b of data.bookmarks) existing.add(b.url);
    if (offset + 200 >= data.total) break;
  }
  return existing;
}

async function main() {
  let found: FoundBookmark[] = [];
  if (SOURCE !== "safari") found.push(...chromeBookmarks());
  if (SOURCE !== "chrome") found.push(...safariBookmarks());

  const seen = new Set<string>();
  found = found.filter((f) => (seen.has(f.url) ? false : (seen.add(f.url), true)));

  const existing = await libraryUrls();
  const fresh = found.filter((f) => !existing.has(f.url)).slice(0, LIMIT);
  const count = (b: FoundBookmark["browser"]) => fresh.filter((f) => f.browser === b).length;

  console.log(
    `[import] ${found.length} unique browser bookmarks found · ${found.length - fresh.length} already saved/skipped · ${fresh.length} to import (chrome ${count("chrome")}, safari ${count("safari")})`,
  );
  for (const f of fresh.slice(0, 10)) {
    console.log(`  • [${f.browser}] ${f.title.slice(0, 60)} — ${f.url.slice(0, 80)}  (${f.folder})`);
  }
  if (fresh.length > 10) console.log(`  … and ${fresh.length - 10} more`);

  if (!APPLY) {
    console.log(
      "\n[import] dry run — re-run with --apply to import. Each save scrapes OG data and AI-categorizes (~1-2s per bookmark).",
    );
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const f of fresh) {
    try {
      const res = await fetch(`${API}/api/bookmarks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: f.url,
          title: f.title,
          browser: f.browser,
          device: "laptop",
          os: "macOS",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ok += 1;
      if (ok % 10 === 0) console.log(`[import] ${ok}/${fresh.length}…`);
    } catch (err) {
      failed += 1;
      console.warn(`[import] failed: ${f.url} (${(err as Error).message})`);
    }
  }
  console.log(`[import] done — ${ok} imported, ${failed} failed`);
}

void main().catch((err) => {
  console.error("[import] fatal:", err.message);
  process.exit(1);
});
