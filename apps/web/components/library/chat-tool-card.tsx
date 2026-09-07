"use client";

import { useState } from "react";
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
  type ToolIconId,
  type ToolView,
} from "@/lib/chat-tools";
import { cn } from "@/lib/utils";
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
 * sources…) sits under the row for the tools that have one; clicking the row
 * toggles a disclosure with the raw input and a compact output. Unknown and
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
  const name = getToolOrDynamicToolName(part);
  const view = describeToolPart(name, part.state, part.input, part.output, part.errorText);
  const Icon = TOOL_ICONS[view.icon];
  const body = richBody(name, part, view, onFilter);
  const hasOutput = part.output !== undefined || part.errorText !== undefined;

  return (
    <div
      data-tool-card={view.phase}
      className="not-prose mb-1 w-full overflow-hidden rounded-lg border bg-background"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={open ? "Hide details" : "Show what was sent and received"}
        className={cn(
          "cursor-pointer flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          (body || open || (view.phase === "error" && view.errorText)) && "border-b",
        )}
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            view.phase === "error" ? "text-destructive" : "text-muted-foreground",
          )}
          aria-hidden
        />
        <span
          className={cn(
            "line-clamp-1 min-w-0 flex-1 [overflow-wrap:anywhere]",
            view.phase === "running" && "text-shimmer font-medium",
            view.phase === "done" && "font-medium",
            view.phase === "error" && "font-medium text-destructive",
          )}
        >
          {view.label}
          {view.detail && (
            <span className={cn("ml-1.5 font-normal", view.phase !== "running" && "text-muted-foreground")}>
              {view.detail}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center text-muted-foreground" aria-hidden>
          {view.phase === "running" ? (
            <Loader size={12} />
          ) : view.phase === "error" ? (
            <CircleAlert className="size-3.5 text-destructive" />
          ) : (
            <Check className="size-3.5 text-emerald-600 dark:text-emerald-500" />
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

      {view.phase === "error" && view.errorText && (
        <p className={cn("px-3 py-2 text-xs text-destructive [overflow-wrap:anywhere]", (body || open) && "border-b")}>
          {view.errorText}
        </p>
      )}

      {body && <div className={cn(open && "border-b")}>{body}</div>}

      {open && (
        <div className="space-y-2 bg-muted/20 px-3 py-2">
          <JsonBlock label="Input" value={part.input} />
          {hasOutput && (
            <JsonBlock
              label={part.errorText !== undefined ? "Error" : "Output"}
              value={part.errorText ?? part.output}
            />
          )}
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
