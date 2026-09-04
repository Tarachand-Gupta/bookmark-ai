"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Folder, Globe, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LibraryFilters } from "@/lib/api";
import { hostOf } from "@/lib/chat-tools";
import { deviceFreshness, formatDeviceAge } from "@/lib/live-format";
import { safeHref } from "@/lib/safe-href";
import { cn } from "@/lib/utils";

/**
 * The RICH RESULT BODIES that sit under a tool row once its output is in
 * (CONTRACT §6 keeps these). Each takes the tool's output shape as the route
 * emits it and renders the actionable view — bookmark cards with filter chips,
 * an SQL result table, web sources, a page preview, sessions, live devices.
 * The row itself (label, spinner/check/error, disclosure) lives in
 * chat-tool-card.tsx; nothing here renders a header.
 */

export interface BookmarkHit {
  id: string;
  title: string;
  url: string;
  category: string;
  tags: string[];
  day: string;
  score: number;
}

export interface SearchToolOutput {
  mode: string;
  fallback: boolean;
  results: BookmarkHit[];
}

export interface SqlToolOutput {
  columns?: string[];
  rows?: unknown[][];
  rowCount?: number;
  truncated?: boolean;
  error?: string;
}

export interface WebSearchOutput {
  results: { title: string; url: string; snippet: string }[];
}

export interface FetchUrlOutput {
  url?: string;
  title?: string | null;
  text?: string;
  truncated?: boolean;
  error?: string;
}

export interface SessionHit {
  id: string;
  name: string;
  tabCount: number;
  browser: string;
  savedAt: string;
  tabs: { title: string; url: string }[];
}

export interface SessionsToolOutput {
  total: number;
  sessions: SessionHit[];
}

export interface LiveDeviceHit {
  label: string;
  browser: string;
  lastSeenAgeSeconds: number;
  tabCount: number;
  hiddenTabCount: number;
  windows: { tabs: { title: string; url: string }[] }[];
}

/** listLiveTabs output: `{enabled:false}` = sharing off, `{error}` = unavailable,
 * else the compacted live devices. Discriminated by which field is present. */
export interface LiveTabsToolOutput {
  enabled?: boolean;
  error?: string;
  devices?: LiveDeviceHit[];
}

// ── searchBookmarks ──────────────────────────────────────────────────────────

export function SearchToolBody({
  output,
  onFilter,
}: {
  output: SearchToolOutput;
  onFilter?: (filters: LibraryFilters) => void;
}) {
  return (
    <BookmarkHits
      hits={output.results ?? []}
      showScore={output.mode === "ai"}
      onFilter={onFilter}
    />
  );
}

/** Cited bookmarks as actionable cards: open, copy link, filter by category/tag. */
export function BookmarkHits({
  hits,
  showScore,
  onFilter,
}: {
  hits: BookmarkHit[];
  showScore: boolean;
  onFilter?: (filters: LibraryFilters) => void;
}) {
  if (!hits.length) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No matches in the library.</p>;
  }
  return (
    <ul className="divide-y">
      {hits.map((r) => {
        const href = safeHref(r.url);
        return (
          <li
            key={r.id}
            className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/50"
          >
            <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                {/* line-clamp-1 (not truncate): nowrap text would set the row's
                    intrinsic min-content width and stretch the page sideways. */}
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="line-clamp-1 min-w-0 text-sm font-medium hover:underline [overflow-wrap:anywhere]"
                  >
                    {r.title}
                  </a>
                ) : (
                  <span className="line-clamp-1 min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                    {r.title}
                  </span>
                )}
                {showScore && (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {Math.round(r.score * 100)}% match
                  </span>
                )}
              </div>
              <p className="line-clamp-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {hostOf(r.url)}
                {r.day ? ` · ${r.day}` : ""}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => onFilter?.({ category: r.category })}
                  title={`Category: ${r.category} — click to filter`}
                  className="cursor-pointer inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground transition-opacity hover:opacity-85"
                >
                  <Folder className="size-2.5" aria-hidden />
                  {r.category}
                </button>
                {(r.tags ?? []).slice(0, 4).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onFilter?.({ tag: t })}
                    title={`Show #${t} bookmarks`}
                    className="cursor-pointer rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    #{t}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <CopyLinkButton url={r.url} />
              {href && (
                <Button variant="ghost" size="icon" className="size-7" asChild>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`Open ${r.title}`}
                    title="Open in new tab"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // Clipboard API can be permission-denied (embedded webviews, focus
      // rules) — the selection-based path only needs the click gesture.
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      aria-label={copied ? "Link copied" : "Copy link"}
      title="Copy link"
      onClick={() => void copy()}
    >
      {copied ? (
        <Check className="size-3.5 text-green-600" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
    </Button>
  );
}

// ── queryDatabase ────────────────────────────────────────────────────────────

/** The SQL that ran (always, even mid-stream) and the result table once in. */
export function SqlToolBody({
  input,
  output,
}: {
  input: { sql?: string } | undefined;
  output: SqlToolOutput | undefined;
}) {
  const sql = typeof input?.sql === "string" ? input.sql : "";
  if (!sql && !output?.columns) return null;
  return (
    <>
      {sql && (
        <pre className="overflow-x-auto bg-muted/30 px-3 py-2 text-[11px] leading-relaxed">
          <code>{sql}</code>
        </pre>
      )}
      {output?.columns && output.rows && (
        <div className={cn(sql && "border-t")}>
          <SqlResultTable columns={output.columns} rows={output.rows} />
        </div>
      )}
    </>
  );
}

/** Compact, horizontally scrollable table for queryDatabase results (first 50 rows). */
function SqlResultTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  if (!rows.length) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No rows.</p>;
  }
  const shown = rows.slice(0, 50);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b bg-muted/30">
            {columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-medium [overflow-wrap:normal]">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, ri) => (
            <tr key={ri} className="border-b last:border-0">
              {columns.map((_, ci) => (
                <td key={ci} className="max-w-[20rem] px-2 py-1 align-top [overflow-wrap:normal] [word-break:normal]">
                  {formatCell(row[ci])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <p className="px-2 py-1 text-[10px] text-muted-foreground">
          +{rows.length - shown.length} more row{rows.length - shown.length === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ── webSearch ────────────────────────────────────────────────────────────────

export function WebSearchToolBody({ output }: { output: WebSearchOutput }) {
  const results = output.results ?? [];
  if (results.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No web results.</p>;
  }
  return (
    <ul className="divide-y">
      {results.map((r, i) => {
        const href = safeHref(r.url);
        return (
          <li key={`${r.url}-${i}`} className="px-3 py-2">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="line-clamp-1 text-sm font-medium hover:underline [overflow-wrap:anywhere]"
              >
                {r.title}
              </a>
            ) : (
              <span className="line-clamp-1 text-sm font-medium [overflow-wrap:anywhere]">
                {r.title}
              </span>
            )}
            <p className="line-clamp-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {hostOf(r.url)}
            </p>
            {r.snippet && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {r.snippet}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── fetchUrl ─────────────────────────────────────────────────────────────────

export function FetchUrlToolBody({ output }: { output: FetchUrlOutput }) {
  if (output.error) return null;
  const href = output.url ? safeHref(output.url) : undefined;
  if (!output.title && !output.text) return null;
  return (
    <div className="px-3 py-2">
      {output.title &&
        (href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm font-medium hover:underline [overflow-wrap:anywhere]"
          >
            {output.title}
          </a>
        ) : (
          <p className="text-sm font-medium [overflow-wrap:anywhere]">{output.title}</p>
        ))}
      {output.text && (
        <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {output.text.slice(0, 300)}
        </p>
      )}
    </div>
  );
}

// ── listSessions ─────────────────────────────────────────────────────────────

export function SessionsToolBody({ output }: { output: SessionsToolOutput }) {
  const sessions = output.sessions ?? [];
  if (sessions.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No saved sessions found.</p>;
  }
  return (
    <ul className="divide-y">
      {sessions.map((s) => (
        <li key={s.id} className="px-3 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="line-clamp-1 min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
              {s.name}
            </span>
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {s.tabCount} tab{s.tabCount === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="mt-1 space-y-0.5">
            {(s.tabs ?? []).slice(0, 5).map((t, i) => {
              const href = safeHref(t.url);
              return (
                <li key={`${t.url}-${i}`}>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="line-clamp-1 text-xs text-muted-foreground hover:text-foreground hover:underline [overflow-wrap:anywhere]"
                    >
                      {t.title || t.url}
                    </a>
                  ) : (
                    <span className="line-clamp-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {t.title || t.url}
                    </span>
                  )}
                </li>
              );
            })}
            {(s.tabs ?? []).length > 5 && (
              <li className="text-[10px] text-muted-foreground">
                +{s.tabCount - 5} more tab{s.tabCount - 5 === 1 ? "" : "s"}
              </li>
            )}
          </ul>
        </li>
      ))}
    </ul>
  );
}

// ── listLiveTabs ─────────────────────────────────────────────────────────────

/** Small favicon-substitute: the host's first letter in a muted dot. The live
 * tool ships no favicon urls (compacted for the model), so we derive one. */
function LetterDot({ text }: { text: string }) {
  const letter = (text.trim()[0] ?? "•").toUpperCase();
  return (
    <span
      aria-hidden
      className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground"
    >
      {letter}
    </span>
  );
}

/**
 * The user's CURRENTLY-OPEN tabs across devices — an emerald freshness dot per
 * device with an "as of …" age. Handles the sharing-off and empty shapes so a
 * rehydrated part renders identically to the live one.
 */
/** `createSkill` / `installSkill` → `{ skill: { id, name, description, enabled? } }`. */
export interface SkillToolOutput {
  skill?: { id?: string; name?: string; description?: string; enabled?: boolean };
}

/**
 * The skill a chat turn just created or installed: name + the one-line
 * description Ask AI will match on, so the user can see what was saved
 * without opening Settings → Skills.
 */
export function SkillToolBody({ output }: { output: SkillToolOutput }) {
  const skill = output.skill;
  if (!skill?.name) return null;
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
        <WandSparkles className="size-3.5 text-muted-foreground" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-xs font-medium">{skill.name}</p>
          {skill.enabled === false && (
            <span className="shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              off
            </span>
          )}
        </div>
        {skill.description && (
          <p className="mt-0.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {skill.description}
          </p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">Saved to Settings → Skills.</p>
      </div>
    </div>
  );
}

export function LiveTabsToolBody({ output }: { output: LiveTabsToolOutput }) {
  if (output.error) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        Live tabs are unavailable right now.
      </p>
    );
  }
  if (!output.enabled) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        Live sharing is off — turn on “Live sessions” sharing in the extension to let the assistant
        see your current tabs.
      </p>
    );
  }
  const devices = output.devices ?? [];
  if (devices.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        No devices are sharing live tabs right now.
      </p>
    );
  }
  return (
    <ul className="divide-y">
      {devices.map((d, di) => {
        const { filled } = deviceFreshness(d.lastSeenAgeSeconds);
        const tabs = (d.windows ?? []).flatMap((w) => w.tabs ?? []);
        return (
          <li key={`${d.label}-${di}`} className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  filled ? "bg-emerald-500" : "border border-muted-foreground/50",
                )}
              />
              <span className="line-clamp-1 min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                {d.label || "Unnamed device"}
              </span>
              <span className="shrink-0 text-xs capitalize text-muted-foreground">{d.browser}</span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {formatDeviceAge(d.lastSeenAgeSeconds)}
              </span>
            </div>
            {tabs.length === 0 ? (
              <p className="mt-1 pl-4 text-[11px] text-muted-foreground">No open tabs.</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {tabs.slice(0, 8).map((t, ti) => {
                  const href = safeHref(t.url);
                  return (
                    <li key={`${t.url}-${ti}`} className="flex items-start gap-2">
                      <LetterDot text={hostOf(t.url)} />
                      <div className="min-w-0 flex-1">
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="line-clamp-1 text-xs font-medium hover:underline [overflow-wrap:anywhere]"
                          >
                            {t.title || t.url}
                          </a>
                        ) : (
                          <span className="line-clamp-1 text-xs font-medium [overflow-wrap:anywhere]">
                            {t.title || t.url}
                          </span>
                        )}
                        <p className="line-clamp-1 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                          {hostOf(t.url)}
                        </p>
                      </div>
                    </li>
                  );
                })}
                {tabs.length > 8 && (
                  <li className="pl-6 text-[10px] text-muted-foreground">
                    +{tabs.length - 8} more tab{tabs.length - 8 === 1 ? "" : "s"}
                  </li>
                )}
                {d.hiddenTabCount > 0 && (
                  <li className="pl-6 text-[10px] text-muted-foreground">+{d.hiddenTabCount} hidden</li>
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
