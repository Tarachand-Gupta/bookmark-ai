import { Bookmark, ChevronDown } from "lucide-react";
import { safeHttpUrl, type ChatContext } from "@bookmark-ai/types";

/** Show only material the user added, never a misleading empty library scope. */
export function ChatMessageSources({
  context,
  sources,
  unavailable = [],
}: {
  context?: ChatContext;
  sources?: { id: string; title: string; url: string }[];
  unavailable?: { id: string; reason: string }[];
}) {
  if (context?.type !== "bookmarks" || !context.bookmarkIds.length) return null;
  const count = context.bookmarkIds.length;
  return (
    <details className="group/sources mb-1 min-w-0 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded py-1 text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Bookmark className="size-3.5 shrink-0" aria-hidden />
        <span>
          {count} attached bookmark{count === 1 ? "" : "s"}
        </span>
        <ChevronDown
          className="size-3 shrink-0 transition-transform group-open/sources:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="mt-1 space-y-2 border-l border-border pl-3">
        <p className="text-muted-foreground">Added to your question · Full library available</p>
        {sources?.map((source) => (
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
        {unavailable.map((source) => (
          <p key={source.id} className="text-muted-foreground">
            {source.reason}
          </p>
        ))}
        {!sources && (
          <p className="text-muted-foreground">
            These bookmarks were attached when you sent this message.
          </p>
        )}
      </div>
    </details>
  );
}
