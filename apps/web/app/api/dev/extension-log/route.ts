import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

/**
 * DEV-ONLY sink for the extension's `diag()` logger (apps/extension/lib/diag.ts).
 * A hard 404 in production. Deliberately does NOT call requireUser: it must
 * accept the Safari extension, whose per-install `safari-web-extension://` origin
 * the shared middleware CORS can't know, so this route sets `Access-Control-
 * Allow-Origin: *` itself and answers its own OPTIONS. Appends each received
 * entry as one NDJSON line to `.dev-extension-log.ndjson` at the repo root
 * (process.cwd() is apps/web → two levels up).
 */

export const runtime = "nodejs";

const LOG_PATH = resolve(process.cwd(), "../../.dev-extension-log.ndjson");

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

export function OPTIONS(): NextResponse {
  if (isProd()) return new NextResponse(null, { status: 404 });
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request): Promise<NextResponse> {
  if (isProd()) return new NextResponse(null, { status: 404 });
  try {
    // Body is sent as text/plain to avoid a CORS preflight; req.json() parses it
    // regardless of the content-type header.
    const body = (await req.json()) as { entries?: unknown };
    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (entries.length > 0) {
      const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
      await appendFile(LOG_PATH, lines, "utf8");
    }
  } catch {
    // Malformed body or fs error — swallow; this endpoint is best-effort.
  }
  return new NextResponse(null, { status: 204, headers: CORS });
}
