import { cn } from "@/lib/utils";
import { mono } from "../primitives";
import { CopyButton } from "./copy-button";

/**
 * Shell lines, one per row, with a copy-all control. Long lines soft-wrap
 * (break-all, hanging under the prompt) rather than clipping behind an
 * overlay scrollbar nobody sees; overflow-x stays as a safety net.
 */
export function CommandBlock({ commands, className }: { commands: string[]; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-1 rounded-xl border border-border/60 bg-background/60 pr-1.5 pt-1.5 dark:bg-background/40",
        className,
      )}
    >
      {/* The pre scrolls sideways on its own; the button sits in its own column
          so a long line never runs underneath it. */}
      <pre
        className={cn(
          mono,
          "min-w-0 flex-1 overflow-x-auto px-4 pb-3.5 pt-2 text-[12.5px] leading-relaxed text-foreground",
        )}
      >
        {commands.map((c, i) => (
          <code key={i} className="block whitespace-pre-wrap break-all pl-4 -indent-4">
            <span aria-hidden className="select-none text-muted-foreground/60">
              ${" "}
            </span>
            {c}
          </code>
        ))}
      </pre>
      <CopyButton text={commands.join("\n")} className="shrink-0" />
    </div>
  );
}
