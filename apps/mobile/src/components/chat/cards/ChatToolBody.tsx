import type { ReactElement } from "react";
import type {
  LiveTabsToolOutput,
  SearchToolOutput,
  SessionsToolOutput,
  SqlToolOutput,
} from "@bookmark-ai/types";
import { toolName, toolPhase, type ToolPartLike } from "../../../lib/chatParts";
import { ChatBookmarksCard } from "./ChatBookmarksCard";
import { ChatLiveTabsCard } from "./ChatLiveTabsCard";
import { ChatSessionsCard } from "./ChatSessionsCard";
import { ChatSqlCard } from "./ChatSqlCard";

/**
 * Which tool gets a rich body under its row, and in which states — mirrors
 * `richBody` in apps/web/components/library/chat-tool-card.tsx. Bodies render
 * only from a settled output the tool considers a success (the `{error}` shape
 * is the row's business), except queryDatabase, whose SQL is worth seeing while
 * it streams and after it fails; listLiveTabs draws its own `{enabled:false}`
 * and `{error}` shapes as one muted note.
 */
export function chatToolBody(part: ToolPartLike, failed: boolean): ReactElement | null {
  const settled = toolPhase(part.state) === "output-available" && part.output !== undefined;
  const ok = settled && !failed;
  switch (toolName(part)) {
    case "searchBookmarks":
      return ok ? <ChatBookmarksCard output={part.output as SearchToolOutput} /> : null;
    case "queryDatabase":
      return <ChatSqlCard input={part.input} output={ok ? (part.output as SqlToolOutput) : undefined} />;
    case "listSessions":
      return ok ? <ChatSessionsCard output={part.output as SessionsToolOutput} /> : null;
    case "listLiveTabs":
      return settled ? <ChatLiveTabsCard output={part.output as LiveTabsToolOutput} /> : null;
    default:
      return null;
  }
}
