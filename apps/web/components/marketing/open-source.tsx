import { Github } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { btnPrimary, display, glass, mono, REPO } from "./primitives";

export function OpenSource() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
      <Reveal>
        <div
          className={cn(
            "relative flex flex-col items-center gap-6 overflow-hidden rounded-3xl px-6 py-16 text-center sm:px-12",
            glass,
          )}
        >
          <span className="flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-background/50">
            <Github className="size-6 text-foreground" aria-hidden />
          </span>
          <h2
            className={cn(
              display,
              "max-w-xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl",
            )}
          >
            Open source, top to bottom.
          </h2>
          <p className="max-w-lg text-muted-foreground">
            The web app, the API, the extension, and the desktop and mobile clients
            are all open source. Read the code, self-host it, or send a pull request.
          </p>
          <a href={REPO} target="_blank" rel="noreferrer noopener" className={btnPrimary}>
            <Github className="size-4" aria-hidden />
            View on GitHub
          </a>
          <p className={cn(mono, "text-[11px] uppercase tracking-[0.25em] text-muted-foreground/70")}>
            Tarachand-Gupta / bookmark-ai
          </p>
        </div>
      </Reveal>
    </section>
  );
}
