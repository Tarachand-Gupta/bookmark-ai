import { McpToolInputError, type AnyMcpTool, type McpToolContext } from "./tool-kit";

/**
 * Hand-rolled, STATELESS MCP over streamable HTTP. No SDK: the server speaks
 * exactly six things (initialize, notifications/*, ping, tools/list, tools/call,
 * and "no") and a dependency for that is a liability, not a shortcut.
 *
 * Statelessness is the design constraint that makes this work on serverless —
 * there is no session to keep alive between invocations, so `Mcp-Session-Id` is
 * accepted and IGNORED (we never issue one, and a client echoing one back must
 * not be treated as resuming anything). Responses are plain application/json,
 * which streamable HTTP explicitly permits; we never open an SSE stream because
 * nothing here is long-running or server-initiated.
 *
 * This module is framework-free (plain objects in, plain objects out) so the
 * dispatcher is unit-testable without a Request/Response or a live DB.
 */

/** Protocol revisions we can speak, newest first. An `initialize` asking for one
 * of these is echoed back verbatim; anything else (including a future revision)
 * is answered with our preferred one and the client decides whether to proceed —
 * that is what the spec's version-negotiation says to do. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const PREFERRED_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const SERVER_INFO = { name: "bookmark-ai", version: "1.0.0" } as const;

/** JSON-RPC 2.0 error codes, plus the MCP-relevant subset of meanings. */
export const JSON_RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** A JSON-RPC id: string or number. Null/absent means "notification". */
export type RpcId = string | number;

export interface RpcResponse {
  jsonrpc: "2.0";
  id: RpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * What the dispatcher decided the HTTP layer should do:
 *  - `respond` → serialize `body` as JSON with status 200.
 *  - `accepted` → a notification: HTTP 202 with an EMPTY body (a notification has
 *    no id, so there is nothing legal to put in a JSON-RPC response).
 */
export type DispatchOutcome =
  | { kind: "respond"; body: RpcResponse }
  | { kind: "accepted" };

function ok(id: RpcId, result: unknown): DispatchOutcome {
  return { kind: "respond", body: { jsonrpc: "2.0", id, result } };
}

function fail(id: RpcId, code: number, message: string): DispatchOutcome {
  return { kind: "respond", body: { jsonrpc: "2.0", id, error: { code, message } } };
}

/** A protocol-level rejection that happens BEFORE an id can be trusted (bad
 * JSON, non-object body, a batch array). JSON-RPC says to use id null there. */
export function protocolError(code: number, message: string): RpcResponse {
  // `id: null` is what the spec prescribes when the id can't be determined; the
  // RpcId type excludes null for the normal paths, so cast at this one boundary.
  return { jsonrpc: "2.0", id: null as unknown as RpcId, error: { code, message } };
}

/**
 * Validate a parsed request body down to a single JSON-RPC request object.
 * Returns the request, or the error response to send instead.
 *
 * Batching is REJECTED: the 2025-06-18 revision removed it, and supporting it
 * would mean inventing per-item semantics for a feature no current client needs.
 */
export function validateRpcBody(
  body: unknown,
): { request: { method: string; id?: unknown; params?: unknown } } | { error: RpcResponse } {
  if (Array.isArray(body)) {
    return {
      error: protocolError(
        JSON_RPC.INVALID_REQUEST,
        "JSON-RPC batching is not supported (removed in MCP 2025-06-18) — send one request per POST",
      ),
    };
  }
  if (typeof body !== "object" || body === null) {
    return { error: protocolError(JSON_RPC.INVALID_REQUEST, "Request body must be a JSON object") };
  }
  const request = body as { jsonrpc?: unknown; method?: unknown; id?: unknown; params?: unknown };
  if (request.jsonrpc !== "2.0") {
    return { error: protocolError(JSON_RPC.INVALID_REQUEST, 'Missing or invalid "jsonrpc": "2.0"') };
  }
  if (typeof request.method !== "string" || request.method === "") {
    return { error: protocolError(JSON_RPC.INVALID_REQUEST, 'Missing or invalid "method"') };
  }
  return { request: { method: request.method, id: request.id, params: request.params } };
}

/** Everything the dispatcher needs from the surrounding request. */
export interface DispatchDeps {
  tools: AnyMcpTool[];
  toolContext: McpToolContext;
  /** Consume one unit of the caller's tiered rate limit. Called ONLY for
   * tools/call — handshake/ping traffic is free so a limited client can still
   * connect and see why it is being refused. */
  checkLimit: () => Promise<{ allowed: true } | { allowed: false; message: string }>;
}

/**
 * Execute one validated JSON-RPC request.
 *
 * Notifications (no id, or any `notifications/*` method) are acknowledged with
 * 202 and no body. Everything else returns a response object.
 */
export async function dispatch(
  request: { method: string; id?: unknown; params?: unknown },
  deps: DispatchDeps,
): Promise<DispatchOutcome> {
  const { method, params } = request;
  const rawId = request.id;
  const isNotification =
    rawId === undefined ||
    rawId === null ||
    method === "notifications/initialized" ||
    method.startsWith("notifications/");
  if (isNotification) return { kind: "accepted" };

  if (typeof rawId !== "string" && typeof rawId !== "number") {
    return { kind: "respond", body: protocolError(JSON_RPC.INVALID_REQUEST, '"id" must be a string or number') };
  }
  const id: RpcId = rawId;

  switch (method) {
    case "initialize": {
      const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      const protocolVersion =
        typeof requested === "string" &&
        (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : PREFERRED_PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion,
        // Tools are the only capability: no resources, prompts, sampling, or
        // logging — and no listChanged, since the catalog only changes when the
        // user edits Settings, which a stateless server can't push.
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: deps.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case "tools/call": {
      const call = params as { name?: unknown; arguments?: unknown } | undefined;
      if (typeof call?.name !== "string") {
        return fail(id, JSON_RPC.INVALID_PARAMS, 'tools/call requires a string "name"');
      }
      const tool = deps.tools.find((t) => t.name === call.name);
      if (!tool) {
        // A disabled tool is indistinguishable from a nonexistent one on purpose
        // — but say so, because "disabled in Settings" is the likely cause and
        // the agent should stop retrying it.
        return toolError(
          id,
          `Unknown or disabled tool "${call.name}". Call tools/list to see what this server currently exposes.`,
        );
      }

      const limit = await deps.checkLimit();
      if (!limit.allowed) return toolError(id, limit.message);

      try {
        const result = await tool.run(deps.toolContext, call.arguments);
        return ok(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
      } catch (err) {
        // Tool failures are RESULTS, not transport errors (MCP spec): the model
        // sees the message and can retry or change approach. Input errors carry
        // their own actionable text; anything else is logged server-side and
        // reported without internals.
        if (err instanceof McpToolInputError) return toolError(id, err.message);
        console.error(`[mcp] tool ${tool.name} failed:`, err);
        return toolError(id, `${tool.name} failed: ${(err as Error).message}`);
      }
    }

    default:
      return fail(id, JSON_RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

/** An MCP tool-level failure: a successful JSON-RPC result carrying isError. */
function toolError(id: RpcId, message: string): DispatchOutcome {
  return ok(id, { content: [{ type: "text", text: message }], isError: true });
}
