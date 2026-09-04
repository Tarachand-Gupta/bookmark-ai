"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Assistant answers rendered as GitHub-flavored markdown (links, lists, code,
 * and — the reason for remark-gfm — tables). Styling is applied via the
 * `components` map with Tailwind classes so it matches the app; wide tables and
 * code blocks scroll inside their own container instead of stretching the bubble.
 *
 * Shared by the answer text and the reasoning disclosure (`muted`), so both
 * render links, lists and code the same way.
 */
export function Markdown({
  children,
  muted,
  className,
}: {
  children: string;
  /** Reasoning / secondary text: smaller and in the muted colour. */
  muted?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "[overflow-wrap:anywhere]",
        muted ? "text-xs leading-relaxed text-muted-foreground" : "text-sm leading-relaxed",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium underline underline-offset-2 hover:opacity-80"
            />
          ),
          p: ({ node, ...props }) => <p {...props} className="my-1.5 first:mt-0 last:mb-0" />,
          ul: ({ node, ...props }) => (
            <ul {...props} className="my-1.5 list-disc space-y-0.5 pl-5" />
          ),
          ol: ({ node, ...props }) => (
            <ol {...props} className="my-1.5 list-decimal space-y-0.5 pl-5" />
          ),
          h1: ({ node, ...props }) => <h1 {...props} className="mt-3 mb-1 text-base font-semibold" />,
          h2: ({ node, ...props }) => <h2 {...props} className="mt-3 mb-1 text-sm font-semibold" />,
          h3: ({ node, ...props }) => <h3 {...props} className="mt-2 mb-1 text-sm font-semibold" />,
          blockquote: ({ node, ...props }) => (
            <blockquote {...props} className="my-1.5 border-l-2 pl-3 text-muted-foreground" />
          ),
          hr: ({ node, ...props }) => <hr {...props} className="my-2 border-border" />,
          pre: ({ node, ...props }) => (
            <pre
              {...props}
              className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed"
            />
          ),
          code: ({ node, className, children, ...props }) => {
            const block = /language-/.test(className ?? "");
            return block ? (
              <code {...props} className={className}>
                {children}
              </code>
            ) : (
              <code
                {...props}
                className={cn("rounded bg-muted px-1 py-0.5 text-[0.85em]", className)}
              >
                {children}
              </code>
            );
          },
          // Cells opt back out of the container's `overflow-wrap: anywhere`:
          // in the narrow chat pane it split "Keep" into "Ke / ep" to squeeze
          // the table in. Whole words stay whole and a wide table scrolls.
          table: ({ node, ...props }) => (
            <div className="my-2 max-w-full overflow-x-auto">
              <table {...props} className="w-full border-collapse text-xs" />
            </div>
          ),
          thead: ({ node, ...props }) => <thead {...props} className="bg-muted/40" />,
          th: ({ node, ...props }) => (
            <th
              {...props}
              className="whitespace-nowrap border border-border px-2 py-1 text-left font-medium [overflow-wrap:normal]"
            />
          ),
          td: ({ node, ...props }) => (
            <td
              {...props}
              className="border border-border px-2 py-1 align-top [overflow-wrap:normal] [word-break:normal]"
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
