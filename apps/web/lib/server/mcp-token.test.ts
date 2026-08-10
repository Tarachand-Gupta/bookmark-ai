import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintDeviceToken } from "@/lib/server/device-token";
import {
  MCP_TOKEN_PREFIX,
  MCP_TOKEN_TTL_SECONDS,
  isMcpConfigured,
  mcpTokenHint,
  mintMcpToken,
  verifyMcpToken,
} from "@/lib/server/mcp-token";

const SECRET = "test-secret-for-mcp-tokens";

beforeEach(() => {
  process.env.DEVICE_TOKEN_SECRET = SECRET;
});

afterEach(() => {
  vi.useRealTimers();
  process.env.DEVICE_TOKEN_SECRET = SECRET;
});

describe("mintMcpToken / verifyMcpToken", () => {
  it("round-trips a token back to its subject and id", () => {
    const minted = mintMcpToken("user_abc");
    expect(minted.token.startsWith(MCP_TOKEN_PREFIX)).toBe(true);

    const verified = verifyMcpToken(minted.token);
    if (!verified) throw new Error("expected the token to verify");
    expect(verified.userId).toBe("user_abc");
    expect(verified.tokenId).toBe(minted.id);
    expect(verified.exp - verified.iat).toBe(MCP_TOKEN_TTL_SECONDS);
  });

  it("never puts a JWT-shaped (dotted) bearer on the wire", () => {
    // LOAD-BEARING: a dotted three-segment bearer crashes Clerk's middleware.
    const { token } = mintMcpToken("user_abc");
    expect(token).not.toContain(".");
    expect(token.split("~")).toHaveLength(3);
  });

  it("mints a distinct jti per token", () => {
    expect(mintMcpToken("user_abc").id).not.toBe(mintMcpToken("user_abc").id);
  });

  it("rejects a tampered payload", () => {
    const { token } = mintMcpToken("user_abc");
    const [header, payload, signature] = token.slice(MCP_TOKEN_PREFIX.length).split("~");
    const forged = Buffer.from(
      JSON.stringify({ sub: "user_victim", iat: 1, exp: 9999999999, jti: "x", scp: "mcp" }),
    ).toString("base64url");
    expect(verifyMcpToken(`${MCP_TOKEN_PREFIX}${header}~${forged}~${signature}`)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const { token } = mintMcpToken("user_abc");
    // Flip a char NEAR the end, never the LAST one: a 32-byte HMAC base64urls
    // to 43 chars, so the final char carries 2 padding bits Buffer.from()
    // ignores — flipping 'A'→'B' there decodes to the SAME bytes and the
    // verify correctly succeeds (this test flaked ~1/64 runs that way).
    const i = token.length - 10;
    const flipped = token.slice(0, i) + (token[i] === "A" ? "B" : "A") + token.slice(i + 1);
    expect(verifyMcpToken(flipped)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = mintMcpToken("user_abc");
    process.env.DEVICE_TOKEN_SECRET = "some-other-secret";
    expect(verifyMcpToken(token)).toBeNull();
  });

  it("rejects an expired token past the skew window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { token } = mintMcpToken("user_abc");
    // Still valid a day before expiry…
    vi.setSystemTime(new Date("2026-12-30T00:00:00Z"));
    expect(verifyMcpToken(token)).not.toBeNull();
    // …and dead well past it.
    vi.setSystemTime(new Date("2027-02-01T00:00:00Z"));
    expect(verifyMcpToken(token)).toBeNull();
  });

  it("rejects a device token (wrong scope), even though the secret matches", () => {
    // The two families share DEVICE_TOKEN_SECRET; only `scp` + prefix separate
    // them, so this is the check that keeps them from cross-honoring.
    const device = mintDeviceToken("user_abc");
    expect(verifyMcpToken(device.token)).toBeNull();
    // And an MCP token wearing the device prefix fails the prefix check.
    const mcp = mintMcpToken("user_abc");
    expect(verifyMcpToken(mcp.token.replace(MCP_TOKEN_PREFIX, "bkd_"))).toBeNull();
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of ["", "bkmcp_", "bkmcp_a~b", "not-a-token", `${MCP_TOKEN_PREFIX}a~b~c`]) {
      expect(verifyMcpToken(bad)).toBeNull();
    }
  });

  it("is unusable (and reports as unconfigured) without a secret", () => {
    const { token } = mintMcpToken("user_abc");
    delete process.env.DEVICE_TOKEN_SECRET;
    expect(isMcpConfigured()).toBe(false);
    expect(verifyMcpToken(token)).toBeNull();
    expect(() => mintMcpToken("user_abc")).toThrow();
  });
});

describe("mcpTokenHint", () => {
  it("shows the first and last 5 characters of the token body, behind the prefix", () => {
    const { token } = mintMcpToken("user_abc");
    const body = token.slice(MCP_TOKEN_PREFIX.length);
    expect(mcpTokenHint(token)).toBe(
      `${MCP_TOKEN_PREFIX}${body.slice(0, 5)}…${body.slice(-5)}`,
    );
    // Same shape every time: prefix + 5 + ellipsis + 5.
    expect(mcpTokenHint(token)).toHaveLength(MCP_TOKEN_PREFIX.length + 11);
  });

  it("derives the same hint whether or not the value carries the prefix", () => {
    const { token } = mintMcpToken("user_abc");
    expect(mcpTokenHint(token.slice(MCP_TOKEN_PREFIX.length))).toBe(mcpTokenHint(token));
  });

  it("identifies a token without being usable as one", () => {
    const a = mintMcpToken("user_abc").token;
    const b = mintMcpToken("user_abc").token;
    // Distinct tokens get distinct hints (the body starts with the same header
    // segment, so it's the trailing signature chars that separate them)…
    expect(mcpTokenHint(a)).not.toBe(mcpTokenHint(b));
    // …and a hint is never a working credential.
    expect(verifyMcpToken(mcpTokenHint(a))).toBeNull();
    expect(a).not.toContain(mcpTokenHint(a));
  });

  it("degrades on a short or degenerate value without leaking it or throwing", () => {
    for (const short of ["", "abc", "0123456789", "01234567890", `${MCP_TOKEN_PREFIX}abc`]) {
      const hint = mcpTokenHint(short);
      expect(hint).toBe(`${MCP_TOKEN_PREFIX}…`);
      const body = short.startsWith(MCP_TOKEN_PREFIX)
        ? short.slice(MCP_TOKEN_PREFIX.length)
        : short;
      if (body) expect(hint).not.toContain(body);
    }
    // The first length that is safe to abbreviate.
    expect(mcpTokenHint("012345678901")).toBe(`${MCP_TOKEN_PREFIX}01234…78901`);
  });
});
