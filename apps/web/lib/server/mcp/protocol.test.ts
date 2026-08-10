import { describe, expect, it, vi } from "vitest";
import {
  JSON_RPC,
  PREFERRED_PROTOCOL_VERSION,
  SERVER_INFO,
  dispatch,
  validateRpcBody,
  type DispatchDeps,
  type DispatchOutcome,
  type RpcResponse,
} from "@/lib/server/mcp/protocol";
import { McpToolInputError, type AnyMcpTool, type McpToolContext } from "@/lib/server/mcp/tool-kit";

/** A stand-in tool: no DB, no engine — the dispatcher only ever sees `run`. */
function fakeTool(name: string, run: AnyMcpTool["run"]): AnyMcpTool {
  return {
    name: name as AnyMcpTool["name"],
    description: `does ${name}`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run,
  };
}

const toolContext = {} as McpToolContext;

function deps(overrides: Partial<DispatchDeps> = {}): DispatchDeps {
  return {
    tools: [fakeTool("search_bookmarks", async () => ({ results: [] }))],
    toolContext,
    checkLimit: async () => ({ allowed: true }),
    ...overrides,
  };
}

/** Narrow a "respond" outcome to its JSON-RPC body. */
function body(outcome: DispatchOutcome): RpcResponse {
  if (outcome.kind !== "respond") throw new Error(`expected a response, got ${outcome.kind}`);
  return outcome.body;
}

describe("validateRpcBody", () => {
  it("accepts a well-formed request", () => {
    const result = validateRpcBody({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect("request" in result && result.request.method).toBe("ping");
  });

  it("rejects a batch array (removed in MCP 2025-06-18)", () => {
    const result = validateRpcBody([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
    expect("error" in result && result.error.error?.code).toBe(JSON_RPC.INVALID_REQUEST);
    expect("error" in result && result.error.error?.message).toMatch(/batching is not supported/i);
  });

  it("rejects non-objects, a missing jsonrpc version, and a missing method", () => {
    for (const bad of ["a string", 42, null]) {
      const result = validateRpcBody(bad);
      expect("error" in result && result.error.error?.code).toBe(JSON_RPC.INVALID_REQUEST);
    }
    expect("error" in validateRpcBody({ id: 1, method: "ping" })).toBe(true);
    expect("error" in validateRpcBody({ jsonrpc: "1.0", id: 1, method: "ping" })).toBe(true);
    expect("error" in validateRpcBody({ jsonrpc: "2.0", id: 1 })).toBe(true);
  });
});

describe("dispatch — handshake", () => {
  it("echoes a protocol version it supports", async () => {
    const outcome = await dispatch(
      { method: "initialize", id: 1, params: { protocolVersion: "2024-11-05" } },
      deps(),
    );
    expect(body(outcome).result).toMatchObject({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  });

  it("answers an unknown/absent version with its preferred one", async () => {
    for (const params of [{ protocolVersion: "2099-01-01" }, {}, undefined]) {
      const outcome = await dispatch({ method: "initialize", id: "x", params }, deps());
      expect((body(outcome).result as { protocolVersion: string }).protocolVersion).toBe(
        PREFERRED_PROTOCOL_VERSION,
      );
    }
  });

  it("accepts notifications with no body to return", async () => {
    for (const request of [
      { method: "notifications/initialized" },
      { method: "notifications/cancelled", id: 7 },
      { method: "ping", id: null },
    ]) {
      expect((await dispatch(request, deps())).kind).toBe("accepted");
    }
  });

  it("answers ping with an empty result", async () => {
    expect(body(await dispatch({ method: "ping", id: 2 }, deps())).result).toEqual({});
  });

  it("reports an unknown method as -32601", async () => {
    const outcome = await dispatch({ method: "resources/list", id: 3 }, deps());
    expect(body(outcome).error?.code).toBe(JSON_RPC.METHOD_NOT_FOUND);
  });
});

describe("dispatch — tools", () => {
  it("lists only the tools it was given", async () => {
    const outcome = await dispatch({ method: "tools/list", id: 1 }, deps());
    expect(body(outcome).result).toEqual({
      tools: [
        {
          name: "search_bookmarks",
          description: "does search_bookmarks",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
    });
  });

  it("returns a tool result as JSON text content", async () => {
    const outcome = await dispatch(
      { method: "tools/call", id: 1, params: { name: "search_bookmarks", arguments: { q: "x" } } },
      deps(),
    );
    expect(body(outcome).result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ results: [] }) }],
    });
  });

  it("reports a disabled/unknown tool as isError, not a JSON-RPC error", async () => {
    const outcome = await dispatch(
      { method: "tools/call", id: 1, params: { name: "save_bookmark" } },
      deps(),
    );
    expect(body(outcome).error).toBeUndefined();
    expect(body(outcome).result).toMatchObject({ isError: true });
    expect((body(outcome).result as { content: { text: string }[] }).content[0].text).toMatch(
      /unknown or disabled tool/i,
    );
  });

  it("reports a tool throw as isError with the message", async () => {
    const failing = deps({
      tools: [
        fakeTool("search_bookmarks", async () => {
          throw new Error("db exploded");
        }),
      ],
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const outcome = await dispatch(
      { method: "tools/call", id: 1, params: { name: "search_bookmarks" } },
      failing,
    );
    spy.mockRestore();
    expect(body(outcome).result).toMatchObject({ isError: true });
    expect((body(outcome).result as { content: { text: string }[] }).content[0].text).toContain(
      "db exploded",
    );
  });

  it("reports invalid arguments as isError without logging", async () => {
    const failing = deps({
      tools: [
        fakeTool("search_bookmarks", async () => {
          throw new McpToolInputError("Invalid arguments for search_bookmarks — query: Required");
        }),
      ],
    });
    const outcome = await dispatch(
      { method: "tools/call", id: 1, params: { name: "search_bookmarks", arguments: {} } },
      failing,
    );
    expect((body(outcome).result as { content: { text: string }[] }).content[0].text).toMatch(
      /query: Required/,
    );
  });

  it("rejects a tools/call with no tool name as -32602", async () => {
    const outcome = await dispatch({ method: "tools/call", id: 1, params: {} }, deps());
    expect(body(outcome).error?.code).toBe(JSON_RPC.INVALID_PARAMS);
  });

  it("surfaces a rate-limit refusal as a tool error, and only for tools/call", async () => {
    const limited = deps({
      checkLimit: async () => ({
        allowed: false,
        message: "Rate limit exceeded (minute): retry after 12 seconds",
      }),
    });
    const call = await dispatch(
      { method: "tools/call", id: 1, params: { name: "search_bookmarks" } },
      limited,
    );
    expect(body(call).result).toMatchObject({
      content: [{ type: "text", text: "Rate limit exceeded (minute): retry after 12 seconds" }],
      isError: true,
    });
    // The handshake stays usable so a limited client can still connect.
    expect(body(await dispatch({ method: "tools/list", id: 2 }, limited)).error).toBeUndefined();
  });

  it("does not consume rate-limit budget for an unknown tool", async () => {
    const checkLimit = vi.fn(async () => ({ allowed: true as const }));
    await dispatch({ method: "tools/call", id: 1, params: { name: "nope" } }, deps({ checkLimit }));
    expect(checkLimit).not.toHaveBeenCalled();
  });
});
