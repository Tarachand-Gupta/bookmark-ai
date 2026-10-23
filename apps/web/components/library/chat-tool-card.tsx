"use client";

import { useId, useState } from "react";
import { getToolOrDynamicToolName, type DynamicToolUIPart, type ToolUIPart } from "ai";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Database,
  FileText,
  Globe,
  Layers,
  Radio,
  Search,
  Sparkles,
  WandSparkles,
  Wrench,
} from "lucide-react";
import { Loader } from "@/components/ai-elements/loader";
import type { LibraryFilters } from "@/lib/api";
import {
  compactJson,
  describeToolPart,
  toolNoun,
  type ToolIconId,
  type ToolView,
} from "@/lib/chat-tools";
import { cn } from "@/lib/utils";
import { safeHttpUrl } from "@bookmark-ai/types";
import { BookmarksCard } from "./chat-bookmarks-card";
import { LiveTabsCard } from "./chat-live-tabs-card";
import { SessionsCard } from "./chat-sessions-card";
import { SqlCard } from "./chat-sql-card";
import { FetchUrlToolBody, SkillToolBody, WebSearchToolBody } from "./chat-tool-bodies";
import type {
  FetchUrlOutput,
  LiveTabsToolOutput,
  SearchToolOutput,
  SessionsToolOutput,
  SkillToolOutput,
  SqlToolOutput,
  WebSearchOutput,
} from "./chat-tool-types";

const TOOL_ICONS: Record<ToolIconId, React.ElementType> = {
  search: Search,
  semantic: Sparkles,
  database: Database,
  sessions: Layers,
  live: Radio,
  web: Globe,
  page: FileText,
  skill: WandSparkles,
  generic: Wrench,
};

export type AnyToolPart = ToolUIPart | DynamicToolUIPart;

/**
 * ONE tool invocation, in any of its states (CONTRACT §6): a row with the
 * tool's own words — "Searching bookmarks for “x”" while it runs (shimmering,
 * spinner), "Found 3 bookmarks" with a check when done, red with the error
 * text on `output-error`. The rich result body (bookmark cards, SQL table,
 * sources…) stays collapsed until requested. Raw input/output lives in a
 * second disclosure so inspecting results never requires reading JSON. Unknown and
 * `dynamic-tool` parts get the same row with generic copy — never a crash.
 */
export function ToolCallCard({
  part,
  onFilter,
}: {
  part: AnyToolPart;
  onFilter?: (filters: LibraryFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const name = getToolOrDynamicToolName(part);
  const view = describeToolPart(name, part.state, part.input, part.output, part.errorText);
  const Icon = TOOL_ICONS[view.icon];
  const body = richBody(name, part, view, onFilter);
  const hasOutput = part.output !== undefined || part.errorText !== undefined;

  return (
    <div
      data-tool-card={view.phase}
      className="not-prose mb-1 w-full overflow-hidden rounded-lg border border-border/60 bg-muted/10"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={detailsId}
        title={open ? "Hide results" : "Show results"}
        className={cn(
          "cursor-pointer flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        )}
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            view.phase === "error" ? "text-destructive" : "text-muted-foreground",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className={cn("block font-medium", view.phase === "error" && "text-destructive")}>
            {toolNoun(name)}
          </span>
          <span
            className={cn(
              "mt-0.5 block truncate text-muted-foreground",
              view.phase === "running" && "text-shimmer",
            )}
            title={[view.label, view.detail].filter(Boolean).join(" · ")}
          >
            {view.label}
            {view.detail ? ` · ${view.detail}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 items-center text-muted-foreground" aria-hidden>
          {view.phase === "running" ? (
            <Loader size={12} />
          ) : view.phase === "error" ? (
            <CircleAlert className="size-3.5 text-destructive" />
          ) : (
            <Check className="size-3.5 text-muted-foreground" />
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
        <span className="sr-only">
          {view.phase === "running" ? "Running" : view.phase === "error" ? "Failed" : "Done"}
        </span>
      </button>

      {open && (
        <div id={detailsId} className="border-t border-border/60">
          {view.phase === "error" && view.errorText && (
            <p
              role="status"
              className="px-3 py-2 text-xs text-destructive [overflow-wrap:anywhere]"
            >
              {view.errorText}
            </p>
          )}
          {body}
          <details className="bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer rounded py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              Technical details
            </summary>
            <div className="mt-2 space-y-2">
              <JsonBlock label="Input" value={part.input} />
              {hasOutput && (
                <JsonBlock
                  label={part.errorText !== undefined ? "Error" : "Output"}
                  value={part.errorText ?? part.output}
                />
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const text = compactJson(value);
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-2 text-[11px] leading-relaxed [overflow-wrap:anywhere]">
        <code>{text || "—"}</code>
      </pre>
    </div>
  );
}

/**
 * The tool-specific result body, or null. Bodies render only from a settled
 * output the tool considers a success (the `{error}` shape is the row's
 * business) — except queryDatabase, whose SQL is worth seeing even while it
 * streams and when it fails.
 */
function richBody(
  name: string,
  part: AnyToolPart,
  view: ToolView,
  onFilter?: (filters: LibraryFilters) => void,
): React.ReactNode {
  const settled = part.state === "output-available" && part.output !== undefined;
  switch (name) {
    case "listContext": {
      if (!settled || view.phase !== "done") return null;
      const output = part.output as {
        sources?: { id: string; title: string; url: string }[];
        unavailable?: { id: string; reason: string }[];
      };
      return (
        <div className="space-y-2 px-3 py-3 text-xs">
          <p className="text-muted-foreground">Your full library remains available.</p>
          {output.sources?.map((source) => (
            <a
              key={source.id}
              href={safeHttpUrl(source.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-words underline-offset-2 hover:underline"
            >
              {source.title || source.url}
            </a>
          ))}
          {output.unavailable?.map((source) => (
            <p key={source.id} className="text-muted-foreground">
              {source.reason}
            </p>
          ))}
        </div>
      );
    }
    case "searchBookmarks":
      return settled && view.phase === "done" ? (
        <BookmarksCard output={part.output as SearchToolOutput} onFilter={onFilter} />
      ) : null;
    case "queryDatabase":
      return (
        <SqlCard
          input={part.input as { sql?: string } | undefined}
          output={settled && view.phase === "done" ? (part.output as SqlToolOutput) : undefined}
        />
      );
    case "webSearch":
      return settled && view.phase === "done" ? (
        <WebSearchToolBody output={part.output as WebSearchOutput} />
      ) : null;
    case "fetchUrl":
      return settled && view.phase === "done" ? (
        <FetchUrlToolBody output={part.output as FetchUrlOutput} />
      ) : null;
    case "listSessions":
      return settled && view.phase === "done" ? (
        <SessionsCard output={part.output as SessionsToolOutput} />
      ) : null;
    case "listLiveTabs":
      return settled ? <LiveTabsCard output={part.output as LiveTabsToolOutput} /> : null;
    case "createSkill":
    case "installSkill":
      return settled && view.phase === "done" ? (
        <SkillToolBody output={part.output as SkillToolOutput} />
      ) : null;
    default:
      return null;
  }
}
