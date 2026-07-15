import { cn } from "@/lib/utils";
import { BookmarkMark, mono, REPO } from "./primitives";

const LINKS = [
  { label: "GitHub", href: REPO, external: true },
  { label: "Privacy", href: "/privacy", external: false },
  { label: "Terms", href: "/terms", external: false },
  { label: "Sign in", href: "/sign-in", external: false },
];

export function Footer() {
  return (
    <footer className="border-t border-border/50">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-6 py-10 sm:flex-row">
        <a href="/" className="flex items-center gap-2" aria-label="Bookmark AI home">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BookmarkMark className="size-3.5" />
          </span>
          <span className={cn(mono, "text-sm font-semibold tracking-tight")}>
            bookmark<span className="text-muted-foreground">.ai</span>
          </span>
        </a>

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground sm:ml-auto">
          {LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target={l.external ? "_blank" : undefined}
              rel={l.external ? "noreferrer noopener" : undefined}
              className="transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <p className={cn(mono, "text-xs text-muted-foreground/70 sm:ml-2")}>© 2026</p>
      </div>
    </footer>
  );
}
