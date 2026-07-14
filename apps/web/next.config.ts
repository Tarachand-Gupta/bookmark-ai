import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Next only auto-loads env files from the app dir; the monorepo keeps its
// single .env at the repo root (GEMINI_API_KEY etc.). Real env always wins.
try {
  const text = readFileSync(resolve(process.cwd(), "../../.env"), "utf8");
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const [, key, raw] = m;
    if (!(key in process.env)) process.env[key] = raw.replace(/^(["'])(.*)\1$/, "$2");
  }
} catch {
  // No root .env — fine, the app runs without AI features.
}

const nextConfig: NextConfig = {
  transpilePackages: [
    "@bookmark-ai/ui",
    "@bookmark-ai/types",
    "@bookmark-ai/db",
    "@bookmark-ai/engine",
  ],
  // @libsql/client ships native bindings for file: URLs — keep it out of the
  // webpack bundle and let Node resolve it at runtime.
  serverExternalPackages: ["@libsql/client", "libsql"],
  images: {
    // OG images come from arbitrary bookmarked sites.
    remotePatterns: [{ protocol: "https", hostname: "**" }, { protocol: "http", hostname: "**" }],
  },
};

export default nextConfig;
