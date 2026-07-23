import { NextResponse, type NextRequest } from "next/server";
import { listModelsInputSchema, type AiModel, type AiProvider } from "@bookmark-ai/types";
import { getUserSettings } from "@bookmark-ai/db";
import { followRedirects } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";
import { decryptApiKey } from "@/lib/server/ai-key-crypto";

/** Upstream returned 401/403 — the API key is bad. Mapped to a 401 for us. */
class UpstreamAuthError extends Error {}

/** Whole-request wall-clock budget for one provider model-list call. */
const PROVIDER_TIMEOUT_MS = 15_000;

/**
 * SSRF-guarded GET through the engine's hardened fetch: http(s) + default ports
 * only, every host DNS-resolved and rejected if it maps to a private / reserved
 * / loopback / link-local (incl. cloud-metadata) address, redirects followed
 * manually and re-validated per hop, and the socket IP-pinned (DNS-rebind proof).
 *
 * CRITICAL: the returned value keeps a provider's HTTP status intact — a 401/403
 * comes back as a normal Response (so the caller maps it to "Invalid API key"),
 * while an SSRF-blocked or unreachable host THROWS out of `followRedirects`
 * (mapped by the POST handler to "Could not reach provider" / 502). That split
 * is what lets us distinguish a bad key from a blocked/dead host.
 */
async function guardedGet(url: string, headers: Record<string, string>): Promise<Response> {
  const res = await followRedirects(url, {
    accept: headers.accept ?? "application/json",
    headers,
    timeoutMs: PROVIDER_TIMEOUT_MS,
  });
  if (res === null) throw new Error("too many redirects"); // → 502
  return res;
}

/**
 * POST /api/settings/ai/models — validate a key by listing the provider's
 * models (a successful list IS the "test connection passed" signal), normalized
 * to `{ models: [{ id, label }] }`. Uses the posted key, or falls back to the
 * stored one. Never logs or echoes the key.
 */
export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready, userId } = ctx;
  await ready;

  const parsed = listModelsInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const { provider, baseUrl } = parsed.data;

  // Prefer the just-typed key; fall back to the stored one; 400 if neither.
  let apiKey = parsed.data.apiKey?.trim() ?? "";
  if (!apiKey) {
    const stored = await getUserSettings(db, userId ?? "local");
    // The stored key is encrypted at rest — decrypt before using it upstream.
    apiKey = decryptApiKey(stored?.aiApiKey ?? null) ?? "";
  }
  if (!apiKey) {
    return NextResponse.json({ error: "An API key is required" }, { status: 400 });
  }

  try {
    const models = await listProviderModels(provider, apiKey, baseUrl);
    return NextResponse.json({ models });
  } catch (err) {
    if (err instanceof UpstreamAuthError) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }
    // SSRF-blocked host, unreachable provider, timeout/abort, or any non-auth
    // upstream failure — all indistinguishable to the client, all 502.
    return NextResponse.json({ error: "Could not reach provider" }, { status: 502 });
  }
}

function listProviderModels(
  provider: AiProvider,
  apiKey: string,
  baseUrl: string | undefined,
): Promise<AiModel[]> {
  switch (provider) {
    case "google":
      return listGoogleModels(apiKey);
    case "openai":
      return listOpenAiModels(apiKey);
    case "anthropic":
      return listAnthropicModels(apiKey);
    case "custom":
      return listCustomModels(apiKey, baseUrl ?? "");
  }
}

async function listGoogleModels(apiKey: string): Promise<AiModel[]> {
  // SECURITY: the key travels in the x-goog-api-key header (matching gemini.ts),
  // never a `?key=` query string — query strings leak into logs, proxies and
  // referrers.
  const res = await guardedGet("https://generativelanguage.googleapis.com/v1beta/models", {
    "x-goog-api-key": apiKey,
    accept: "application/json",
  });
  if (res.status === 401 || res.status === 403) throw new UpstreamAuthError();
  if (!res.ok) throw new Error(`google ${res.status}`);
  const data = (await res.json()) as {
    models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
  };
  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => {
      const id = (m.name ?? "").replace(/^models\//, "");
      return { id, label: m.displayName ?? id };
    })
    .filter((m) => m.id);
}

async function listOpenAiModels(apiKey: string): Promise<AiModel[]> {
  const res = await guardedGet("https://api.openai.com/v1/models", {
    authorization: `Bearer ${apiKey}`,
    accept: "application/json",
  });
  if (res.status === 401 || res.status === 403) throw new UpstreamAuthError();
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const data = (await res.json()) as { data?: { id?: string }[] };
  return (data.data ?? [])
    .map((m) => m.id ?? "")
    .filter((id) => /^(gpt|o[0-9])/.test(id))
    .sort()
    .map((id) => ({ id, label: id }));
}

async function listAnthropicModels(apiKey: string): Promise<AiModel[]> {
  const res = await guardedGet("https://api.anthropic.com/v1/models", {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    accept: "application/json",
  });
  if (res.status === 401 || res.status === 403) throw new UpstreamAuthError();
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = (await res.json()) as { data?: { id?: string; display_name?: string }[] };
  return (data.data ?? [])
    .filter((m): m is { id: string; display_name?: string } => !!m.id)
    .map((m) => ({ id: m.id, label: m.display_name ?? m.id }));
}

async function listCustomModels(apiKey: string, baseUrl: string): Promise<AiModel[]> {
  const base = baseUrl.replace(/\/+$/, "");
  // SECURITY (SSRF): `base` is fully user-supplied, so this MUST go through the
  // guarded fetch — it rejects loopback/private/link-local/metadata hosts and
  // non-web ports, and IP-pins the connection so a rebinding resolver can't
  // swap in an internal address after validation.
  const res = await guardedGet(`${base}/models`, {
    authorization: `Bearer ${apiKey}`,
    accept: "application/json",
  });
  if (res.status === 401 || res.status === 403) throw new UpstreamAuthError();
  if (!res.ok) throw new Error(`custom ${res.status}`);
  const data = (await res.json()) as { data?: { id?: string }[] };
  return (data.data ?? [])
    .map((m) => m.id ?? "")
    .filter(Boolean)
    .map((id) => ({ id, label: id }));
}
