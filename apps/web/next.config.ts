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
  async headers() {
    // Content-Security-Policy is sent REPORT-ONLY on purpose: it never blocks a
    // request, it only reports violations. The allowlist below is a best-effort
    // model of what the app legitimately loads (Next inline/eval for dev +
    // hydration, Clerk, Cloudflare Turnstile, the live-sessions SSE server). Do
    // NOT flip this to an enforced `Content-Security-Policy` header until it has
    // been run in report-only through a monitored rollout (collect real reports,
    // confirm zero legitimate violations across web + extension-hosted flows),
    // otherwise a missed source will hard-break the app for users.
    const csp = [
      "default-src 'self'",
      // 'unsafe-inline'/'unsafe-eval' are required by Next's dev runtime and
      // hydration; the Clerk + Turnstile hosts serve the auth/challenge scripts.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://clerk.bookmark-ai.cloud https://*.clerk.accounts.dev https://challenges.cloudflare.com",
      // XHR/fetch/websocket targets: same-origin API, Clerk, the live SSE server,
      // and localhost (http + ws) for local dev. (Turso is server-side only — no
      // client connection, so it is intentionally absent here.)
      "connect-src 'self' https://clerk.bookmark-ai.cloud https://*.clerk.accounts.dev https://live.bookmark-ai.cloud http://localhost:* ws://localhost:*",
      "img-src 'self' https: data:",
      "style-src 'self' 'unsafe-inline'",
      "frame-src https://challenges.cloudflare.com https://*.clerk.accounts.dev",
      "worker-src 'self' blob:",
    ].join("; ");

    // Minimal Permissions-Policy: deny every powerful feature the app never uses.
    const permissionsPolicy = [
      "accelerometer=()",
      "autoplay=()",
      "camera=()",
      "display-capture=()",
      "encrypted-media=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "usb=()",
    ].join(", ");

    // Applied to every route. These are response headers on the HTML pages; the
    // /api CORS headers are set separately in middleware.ts and require-user.ts
    // and use different header names, so this does not affect API CORS.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: permissionsPolicy },
          { key: "Content-Security-Policy-Report-Only", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
