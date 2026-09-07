"use client";

import { WandSparkles } from "lucide-react";
import { hostOf } from "@/lib/chat-tools";
import { safeHref } from "@/lib/safe-href";
import type { FetchUrlOutput, SkillToolOutput, WebSearchOutput } from "./chat-tool-types";

/**
 * The SMALL, non-list result bodies that sit under a tool row (web sources, a
 * page preview, a saved skill). The list-shaped tools each own a card file of
 * their own — chat-live-tabs-card, chat-bookmarks-card, chat-sql-card,
 * chat-sessions-card — because those need filtering, grouping and truncation.
 * The row itself (label, spinner/check/error, disclosure) lives in
 * chat-tool-card.tsx; nothing here renders a header.
 */

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
          <li key={`${r.url}-${i}`} className="px-3 py-2 transition-colors hover:bg-muted/50">
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
              <span className="line-clamp-1 text-sm font-medium [overflow-wrap:anywhere]">{r.title}</span>
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

// ── createSkill / installSkill ───────────────────────────────────────────────

/**
 * The skill a chat turn just created or installed: name + the one-line
 * description Ask AI will match on, so the user can see what was saved without
 * opening Settings → Skills.
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
