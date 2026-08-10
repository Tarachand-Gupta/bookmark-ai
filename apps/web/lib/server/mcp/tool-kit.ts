import type { z } from "zod";
import type { Db } from "@bookmark-ai/db";
import type { McpToolName } from "@bookmark-ai/types";
import type { GeminiClient } from "@bookmark-ai/engine";

/**
 * Tool plumbing shared by the catalog (tools.ts) and the dispatcher
 * (protocol.ts). Split out so the dispatcher — and its tests — depend on NOTHING
 * but these declarations: every import here is type-only, so this module pulls no
 * db/engine/zod code into a process that only wants to speak JSON-RPC.
 */

/** What a tool needs to run. `schedule` defers post-response work; the route
 * supplies Next's `after()` so the tool layer stays framework-free (and
 * testable without a request scope). */
export interface McpToolContext {
  db: Db;
  gemini: GeminiClient | null;
  /** Resolves once the tenant DB's schema/migrations have been ensured. */
  ready: Promise<void>;
  schedule: (work: () => Promise<void>) => void;
}

/** JSON Schema as the MCP `tools/list` result carries it. Loose by design — this
 * is a wire document, not something we introspect. */
export type JsonSchema = Record<string, unknown>;

/** A tool as its author declares it: a Zod parser for the arguments plus the
 * hand-written JSON Schema clients are shown. */
export interface McpTool<TArgs> {
  name: McpToolName;
  description: string;
  inputSchema: JsonSchema;
  // Input type is `unknown`: arguments arrive as raw JSON-RPC params, and the
  // schema's defaults mean the parsed OUTPUT has fields the input may omit.
  args: z.ZodType<TArgs, z.ZodTypeDef, unknown>;
  execute: (ctx: McpToolContext, args: TArgs) => Promise<unknown>;
}

/**
 * A tool with its argument type erased, so the dispatcher can hold all of them
 * in one list. `run` validates raw JSON-RPC arguments before executing — the
 * type parameter only ever exists inside `defineTool`.
 */
export interface AnyMcpTool {
  name: McpToolName;
  description: string;
  inputSchema: JsonSchema;
  run: (ctx: McpToolContext, rawArgs: unknown) => Promise<unknown>;
}

/** Invalid tool arguments. The dispatcher reports these as an MCP tool error
 * (isError: true) so the model can correct itself, not a JSON-RPC error. */
export class McpToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolInputError";
  }
}

export function defineTool<TArgs>(tool: McpTool<TArgs>): AnyMcpTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    run: async (ctx, rawArgs) => {
      // Absent arguments are legal for a no-parameter tool — normalize to {}.
      const parsed = tool.args.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
        throw new McpToolInputError(
          `Invalid arguments for ${tool.name} — ${where}${issue?.message ?? "does not match the input schema"}`,
        );
      }
      return tool.execute(ctx, parsed.data);
    },
  };
}
