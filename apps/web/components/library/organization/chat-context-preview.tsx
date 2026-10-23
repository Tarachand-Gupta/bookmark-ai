"use client";
import { useEffect, useState } from "react";
import { Bookmark, Library } from "lucide-react";
import { safeHttpUrl, type ChatContext } from "@bookmark-ai/types";
import { resolveComposerContext } from "@/lib/api";

export function ChatContextPreview({
  context,
  accountId,
}: {
  context: ChatContext;
  accountId: string;
}) {
  const [result, setResult] = useState<
    Awaited<ReturnType<typeof resolveComposerContext>>["resolved"] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(context);
  useEffect(() => {
    if (context.type === "library") return;
    const controller = new AbortController();
    setResult(null);
    setError(null);
    void resolveComposerContext(context, accountId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setResult(value.resolved);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Couldn’t check these bookmarks. Try reopening this preview.");
      });
    return () => controller.abort();
  }, [key, accountId]);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Library className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <p>Your full library is always available. Attached bookmarks help focus the answer.</p>
      </div>
      {context.type !== "library" &&
        (error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : !result ? (
          <p role="status" className="text-xs text-muted-foreground">
            Checking bookmarks…
          </p>
        ) : (
          <>
            <p className="text-xs font-medium">
              {result.sources.length} attached bookmark{result.sources.length === 1 ? "" : "s"}
            </p>
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {result.sources.slice(0, 100).map((source) => (
                <li key={source.id}>
                  <a
                    href={safeHttpUrl(source.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 items-start gap-2 rounded-md p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <Bookmark
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {source.title || source.url}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {source.url}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            {result.unavailable.map((item) => (
              <p key={item.id} className="text-xs text-muted-foreground">
                {item.reason} · Your library can still be searched.
              </p>
            ))}
            {result.sources.length > 100 && (
              <p className="text-xs text-muted-foreground">
                {result.sources.length - 100} more included
              </p>
            )}
          </>
        ))}
    </div>
  );
}
