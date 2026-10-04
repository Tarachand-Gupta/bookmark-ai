import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  createDb: vi.fn(() => { throw new Error("Health must not open a content database"); }),
  connectPostgres: vi.fn(() => { throw new Error("Health must not open a master database"); }),
  ensureSchema: vi.fn(), ensureMasterSchema: vi.fn(),
}));
vi.mock("@bookmark-ai/db", async (original) => ({
  ...await original<typeof import("@bookmark-ai/db")>(), ...database,
}));
vi.mock("@/lib/server/observability/request-logging", () => ({
  withRequestLogging: (_route: string, _method: string, handler: () => Response) => handler,
}));
import { GET } from "@/app/api/health/route";
import { getApiContext } from "./context";

describe("public health liveness without database routing", () => {
  const store = globalThis as typeof globalThis & { __bookmarkGemini?: unknown };
  const originalGemini = store.__bookmarkGemini;
  beforeEach(() => { delete store.__bookmarkGemini; vi.clearAllMocks(); });
  afterEach(() => { store.__bookmarkGemini = originalGemini; vi.unstubAllEnvs(); });

  for (const configuration of [
    { provider: "supabase", variant: "supabase-qa", key: "", ai: false },
    { provider: "supabase", variant: "supabase-qa", key: "fixture-key", ai: true },
    { provider: "", variant: "supabase-qa", key: "", ai: false },
    { provider: "clerk", variant: "", key: "fixture-key", ai: true },
  ]) it(`returns200 with configured AI=${configuration.ai} for ${configuration.provider || "missing provider"}/${configuration.variant || "legacy"}`, async () => {
    vi.stubEnv("AUTH_PROVIDER", configuration.provider);
    vi.stubEnv("BOOKMARK_BUILD_VARIANT", configuration.variant);
    vi.stubEnv("GEMINI_API_KEY", configuration.key);
    // The actual isolation guard still rejects the old health dependency.
    if (configuration.variant === "supabase-qa") expect(() => getApiContext()).toThrow("isolated tenant routing");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ai: configuration.ai });
    expect(database.createDb).not.toHaveBeenCalled();
    expect(database.connectPostgres).not.toHaveBeenCalled();
    expect(database.ensureSchema).not.toHaveBeenCalled();
    expect(database.ensureMasterSchema).not.toHaveBeenCalled();
  });
});
