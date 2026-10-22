import { describe, it, expect, vi } from "vitest";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import {
  createSupabaseVerifier,
  InvalidSessionError,
  AuthUnavailableError,
  classifyOAuthClient,
  extensionRouteAllowed,
} from "@bookmark-ai/engine";
import { CredentialCipher } from "@bookmark-ai/db";

const uid = "4dc1f59f-5fef-4f6a-83b7-b53d182489bc",
  sid = "017b00e1-3348-476e-972a-1d6b80a6fb66";
async function fixture(extra: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test";
  const token = await new SignJWT({ session_id: sid, role: "authenticated", aal: "aal1", ...extra })
    .setProtectedHeader({ alg: "ES256", kid: "test" })
    .setSubject(uid)
    .setIssuer("https://qa.supabase.co/auth/v1")
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(privateKey);
  return { token, key: createLocalJWKSet({ keys: [jwk] }) };
}
describe("online native session verification", () => {
  it("rejects random, wrong project and missing session before provider reads", async () => {
    const f = await fixture({ session_id: null });
    const fetcher = vi.fn();
    const verify = createSupabaseVerifier(
      { url: "https://qa.supabase.co", publishableKey: "publishable" },
      { key: f.key, fetch: fetcher },
    );
    await expect(verify("random")).rejects.toBeInstanceOf(InvalidSessionError);
    await expect(verify(f.token)).rejects.toBeInstanceOf(InvalidSessionError);
    const wrong = createSupabaseVerifier(
      { url: "https://other.supabase.co", publishableKey: "publishable" },
      { key: f.key, fetch: fetcher },
    );
    await expect(wrong(f.token)).rejects.toBeInstanceOf(InvalidSessionError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("never caches positive approval; copied unexpired JWT fails immediately after remote revocation", async () => {
    const f = await fixture();
    let revoked = false;
    const fetcher = vi.fn(
      async () =>
        new Response(revoked ? "{}" : JSON.stringify({ id: uid, email: "qa@example.invalid" }), {
          status: revoked ? 401 : 200,
        }),
    );
    const verify = createSupabaseVerifier(
      { url: "https://qa.supabase.co", publishableKey: "publishable" },
      { key: f.key, fetch: fetcher as typeof fetch },
    );
    expect((await verify(f.token)).sessionId).toBe(sid);
    revoked = true;
    await expect(verify(f.token)).rejects.toBeInstanceOf(InvalidSessionError);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://qa.supabase.co/auth/v1/user",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
  it("distinguishes provider outage from logout and rejects mismatched users", async () => {
    const f = await fixture();
    const cfg = { url: "https://qa.supabase.co", publishableKey: "publishable" };
    await expect(
      createSupabaseVerifier(cfg, {
        key: f.key,
        fetch: vi.fn(async () => new Response("{}", { status: 503 })) as typeof fetch,
      })(f.token),
    ).rejects.toBeInstanceOf(AuthUnavailableError);
    await expect(
      createSupabaseVerifier(cfg, {
        key: f.key,
        fetch: vi.fn(async () => new Response(JSON.stringify({ id: sid }))) as typeof fetch,
      })(f.token),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });
});
describe("OAuth extension authority", () => {
  it("uses signed client classification and closed route scope", () => {
    expect(classifyOAuthClient(undefined, ["trusted"])).toBe("human");
    expect(classifyOAuthClient("unknown", ["trusted"])).toBe("denied");
    expect(classifyOAuthClient("trusted", ["trusted"])).toBe("extension");
    for (const route of [
      "GET /api/export",
      "POST /api/account",
      "DELETE /api/account",
      "POST /api/mcp/tokens",
      "GET /api/auth/sessions",
    ])
      expect(extensionRouteAllowed(route)).toBe(false);
    for (const route of [
      "GET /api/bookmarks",
      "GET /api/organization",
      "PATCH /api/bookmarks/abc",
      "POST /api/organization/operations",
      "GET /api/organization/operations/abc",
      "POST /api/organization/operations/abc/retry",
      "POST /api/composer/handoffs",
      "POST /api/import/bookmarks",
    ])
      expect(extensionRouteAllowed(route)).toBe(true);
    expect(extensionRouteAllowed("POST /api/bookmarks")).toBe(true);
    expect(extensionRouteAllowed("DELETE /api/bookmarks/abc")).toBe(true);
    expect(extensionRouteAllowed(null)).toBe(false);
    expect(extensionRouteAllowed("DELETE /api/bookmarks/abc/other")).toBe(false);
  });
});
describe("encrypted master credentials", () => {
  it("authenticates owner, ciphertext, and key; never returns plaintext storage", () => {
    const c = new CredentialCipher(Buffer.alloc(32, 7).toString("base64"));
    const encrypted = c.encrypt("test-tenant-secret", uid);
    expect(encrypted).not.toContain("test-tenant-secret");
    expect(c.decrypt(encrypted, uid)).toBe("test-tenant-secret");
    expect(() => c.decrypt(encrypted, sid)).toThrow();
    expect(() => new CredentialCipher("invalid")).toThrow();
    const parts = encrypted.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => c.decrypt(parts.join("."), uid)).toThrow();
  });
});
