"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Copy, Loader2, Plug, Trash2 } from "lucide-react";
import {
  MCP_TOOL_NAMES,
  type McpToken,
  type McpToolName,
} from "@bookmark-ai/types";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  createMcpToken,
  getSettings,
  listMcpTokens,
  revokeMcpToken,
  updateSettings,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Switch } from "./devices-settings";
import { SettingsGroup, SettingsRow, SettingsSection } from "./settings-section";

/**
 * Settings → MCP. Connect an external agent (Claude Code, Claude Desktop, any MCP
 * host) to this library over `POST /api/mcp` with a long-lived bearer token.
 *
 * Two independent pieces of state: which TOOLS the endpoint exposes (stored in
 * user_settings, so it applies to every token at once) and the TOKENS themselves
 * (each revocable). A token's value is shown once, right after minting, and is
 * never retrievable afterwards — the server stores only its id plus a
 * `bkmcp_xxxxx…xxxxx` display hint, which is how a row in the list can be matched
 * to the credential sitting in some client's config.
 *
 * Layout order is deliberate: endpoint → client setup → tools → tokens. Setup is
 * the thing a first-time visitor needs (and it seeds its snippets from a
 * just-minted token via `fresh`, which lives in this component's state, so it can
 * render above the mint form that sets it).
 */

/** What each tool does, in the user's terms (the LLM-facing descriptions live
 * server-side in lib/server/mcp/tools.ts). */
const TOOL_COPY: Record<McpToolName, { label: string; blurb: string }> = {
  search_bookmarks: {
    label: "Search bookmarks",
    blurb: "Find saved pages by keyword, meaning, or a blend of both.",
  },
  save_bookmark: {
    label: "Save a bookmark",
    blurb: "Let the agent add new URLs to your library. The only tool that writes.",
  },
  list_bookmarks: {
    label: "Browse bookmarks",
    blurb: "Page through your library, filtered by category, tag, browser, device, or day.",
  },
  get_library_overview: {
    label: "Library overview",
    blurb: "Your categories, tags, devices, days, and totals — with counts.",
  },
};

/** Small copy-to-clipboard button. Falls back to a hidden textarea + execCommand
 * because the async Clipboard API is permission-denied in some webviews. */
function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    }
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={label}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/**
 * A monospace block for URLs, snippets and secrets. `wrap` breaks mid-token so a
 * 259-char token is fully visible; otherwise long lines scroll INSIDE this box.
 * Either way `min-w-0` is required: without it this block's min-content width
 * propagates up and widens the settings dialog past its own clipped edge (the
 * Generate/Revoke buttons ended up off-screen). See settings-dialog.tsx.
 */
function CodeBlock({ children, wrap }: { children: string; wrap?: boolean }) {
  return (
    <pre
      className={cn(
        "min-w-0 max-w-full rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed",
        wrap ? "whitespace-pre-wrap break-all" : "overflow-x-auto",
      )}
    >
      <code className="font-mono">{children}</code>
    </pre>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toLocaleString();
}

export function McpSection() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // null = never configured, which means every tool is enabled (server default).
  const [tools, setTools] = useState<McpToolName[] | null>(null);
  const [toolsBusy, setToolsBusy] = useState(false);

  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [name, setName] = useState("");
  const [minting, setMinting] = useState(false);
  /** The just-minted secret, held in memory only until the user navigates away.
   * Carries the token's `id` so revoking THAT token can drop the card — it used
   * to keep displaying a secret that no longer authenticated anything. */
  const [fresh, setFresh] = useState<{ id: string; token: string; name: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  // The endpoint is always this app's own origin — resolved client-side so a
  // self-hosted install shows its own URL without any build-time config.
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const reloadTokens = useCallback(async () => {
    const { tokens: list } = await listMcpTokens();
    setTokens(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getSettings(), listMcpTokens()])
      .then(([{ settings }, { tokens: list }]) => {
        if (cancelled) return;
        setTools(settings.mcpTools);
        setTokens(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled = (tool: McpToolName) => tools === null || tools.includes(tool);

  /** Persist the allowlist as an explicit array — once the user touches a toggle
   * we stop relying on the null "everything" default, so a tool added in a later
   * release stays off until they opt in. */
  const toggleTool = async (tool: McpToolName, next: boolean) => {
    const prev = tools;
    const current = tools ?? [...MCP_TOOL_NAMES];
    const updated = next
      ? MCP_TOOL_NAMES.filter((t) => t === tool || current.includes(t))
      : current.filter((t) => t !== tool);
    setTools(updated);
    setToolsBusy(true);
    setError(null);
    try {
      const { settings } = await updateSettings({ mcpTools: updated });
      setTools(settings.mcpTools);
    } catch (e) {
      setError((e as Error).message);
      setTools(prev);
    } finally {
      setToolsBusy(false);
    }
  };

  const mint = async () => {
    setMinting(true);
    setError(null);
    setFresh(null);
    try {
      const created = await createMcpToken(name.trim());
      setFresh({ id: created.id, token: created.token, name: created.name });
      setName("");
      await reloadTokens();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMinting(false);
    }
  };

  const revoke = async (id: string) => {
    setRevoking(id);
    setError(null);
    try {
      await revokeMcpToken(id);
      // The show-once card is that token's secret — a revoked one must not stay
      // on screen (and must stop seeding the client-setup snippets).
      setFresh((f) => (f && f.id === id ? null : f));
      await reloadTokens();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRevoking(null);
      setConfirmRevoke(null);
    }
  };

  const endpoint = origin ? `${origin}/api/mcp` : "/api/mcp";
  const tokenPlaceholder = fresh?.token ?? "<YOUR_TOKEN>";
  const jsonConfig = JSON.stringify(
    {
      mcpServers: {
        "bookmark-ai": {
          type: "http",
          url: endpoint,
          headers: { Authorization: `Bearer ${tokenPlaceholder}` },
        },
      },
    },
    null,
    2,
  );
  const claudeCodeCommand = `claude mcp add --transport http bookmark-ai ${endpoint} --header "Authorization: Bearer ${tokenPlaceholder}"`;

  return (
    <SettingsSection
      title="MCP server"
      icon={Plug}
      description="Give an AI assistant direct access to this library. Bookmark AI speaks the Model Context Protocol over HTTP, so any MCP client — Claude Code, Claude Desktop, your own agent — can search, browse, and save bookmarks on your behalf using a token you mint here."
    >
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : (
        <>
          <SettingsGroup title="Endpoint">
            <CodeBlock>{endpoint}</CodeBlock>
            <CopyButton value={endpoint} label="Copy endpoint" />
          </SettingsGroup>

          {/* Client setup sits directly under the endpoint: copy the command,
              you're connected. It reads `fresh`, which the mint flow further
              down sets — same component state, so source order is irrelevant
              (the only cross-block dependency, and it flows through state, not
              through render order). */}
          <SettingsGroup divided className="min-w-0">
            <Collapsible className="min-w-0">
              <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 text-sm font-semibold tracking-tight">
                Client setup
                <ChevronDown
                  className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                  aria-hidden
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="min-w-0 space-y-3 pt-3">
                <p className="text-xs text-muted-foreground">Claude Code — one command:</p>
                <CodeBlock>{claudeCodeCommand}</CodeBlock>
                <CopyButton value={claudeCodeCommand} label="Copy command" />
                <p className="text-xs text-muted-foreground">
                  Or add this to any client&apos;s MCP config file:
                </p>
                <CodeBlock>{jsonConfig}</CodeBlock>
                <CopyButton value={jsonConfig} label="Copy config" />
                {/* The snippets are seeded with the just-minted secret when there
                    is one, so telling the user to substitute a placeholder that
                    isn't there sends them looking for a problem — and hides that
                    what they just copied IS a live credential. */}
                {fresh ? (
                  <p className="text-xs text-muted-foreground">
                    Both snippets already contain the token you just generated — nothing to
                    substitute. They&apos;re as sensitive as the token itself, so paste them
                    somewhere private.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Replace <code className="font-mono">&lt;YOUR_TOKEN&gt;</code> with a token from
                    below if you generated it earlier.
                  </p>
                )}
              </CollapsibleContent>
            </Collapsible>
          </SettingsGroup>

          <SettingsGroup
            divided
            title="Tools"
            description="What connected assistants are allowed to do. Applies to every token."
          >
            {MCP_TOOL_NAMES.map((tool) => (
              <SettingsRow
                key={tool}
                label={TOOL_COPY[tool].label}
                htmlFor={`mcp-tool-${tool}`}
                description={TOOL_COPY[tool].blurb}
                control={
                  <Switch
                    id={`mcp-tool-${tool}`}
                    checked={enabled(tool)}
                    disabled={toolsBusy}
                    onChange={(next) => void toggleTool(tool, next)}
                  />
                }
              />
            ))}
          </SettingsGroup>

          <SettingsGroup
            divided
            title="Tokens"
            description="One token per client, so you can revoke a single machine without touching the rest. Tokens are valid for a year."
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Token name, e.g. Claude Code on my laptop"
                maxLength={60}
                className="max-w-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void mint()}
                disabled={minting || name.trim() === ""}
              >
                {minting ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Generating…
                  </>
                ) : (
                  "Generate token"
                )}
              </Button>
            </div>

            {fresh && (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <p className="text-xs font-medium">
                  Copy “{fresh.name}” now — this is the only time it will be shown.
                </p>
                {/* Wrapped, not scrolled: a secret you have to drag sideways to
                    read (or verify you copied) is a worse trade than four lines. */}
                <CodeBlock wrap>{fresh.token}</CodeBlock>
                <CopyButton value={fresh.token} label="Copy token" />
              </div>
            )}

            {tokens.length === 0 ? (
              <p className="text-xs text-muted-foreground">No tokens yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {tokens.map((token) => (
                  <li
                    key={token.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {token.name}
                        {token.revokedAt && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            revoked
                          </span>
                        )}
                      </p>
                      {/* Which token this row IS — the first/last 5 chars of the
                          value, captured at mint time (the value itself is never
                          stored). Null for tokens minted before the column
                          existed: render nothing rather than an empty line. */}
                      {token.hint && (
                        <p className="font-mono text-xs text-muted-foreground">{token.hint}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Created {formatWhen(token.createdAt)} · last used{" "}
                        {formatWhen(token.lastUsedAt)}
                      </p>
                    </div>
                    {!token.revokedAt &&
                      (confirmRevoke === token.id ? (
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => void revoke(token.id)}
                            disabled={revoking === token.id}
                          >
                            {revoking === token.id ? (
                              <>
                                <Loader2 className="animate-spin" aria-hidden />
                                Revoking…
                              </>
                            ) : (
                              "Confirm revoke"
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmRevoke(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmRevoke(token.id)}
                        >
                          <Trash2 aria-hidden />
                          Revoke
                        </Button>
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </SettingsGroup>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}
    </SettingsSection>
  );
}
