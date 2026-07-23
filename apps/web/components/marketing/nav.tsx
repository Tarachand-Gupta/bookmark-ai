import { Github } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { BookmarkMark, DOCS_URL, mono, REPO, Wordmark } from "./primitives";

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/60 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-6">
        <a href="/" className="flex items-center gap-2.5" aria-label="Bookmark AI home">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BookmarkMark className="size-4" />
          </span>
          <Wordmark className="text-[0.9rem]" />
        </a>

        <nav className="ml-auto flex items-center gap-1 sm:gap-2">
          <a
            href="#platforms"
            className={cn(
              mono,
              "hidden rounded-md px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground md:inline-flex",
            )}
          >
            Platforms
          </a>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(
              mono,
              "hidden rounded-md px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground md:inline-flex",
            )}
          >
            Docs
          </a>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="GitHub repository"
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Github className="size-[1.15rem]" aria-hidden />
          </a>
          <ThemeToggle />
          <a
            href="/sign-in"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground sm:inline-flex"
          >
            Sign in
          </a>
          {/* shrink-0 + nowrap: the pill is a fixed h-9, so letting flex squeeze
              it wraps the label onto a second line and it bursts out of its own
              height. It gives up width last, not first. */}
          <a
            href="/sign-up"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Get started
          </a>
        </nav>
      </div>
    </header>
  );
}
