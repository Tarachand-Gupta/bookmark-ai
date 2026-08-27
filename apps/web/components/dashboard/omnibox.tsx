"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { askAiHref, searchHref } from "./links";

/**
 * Search-first landing control (doc §3, tier 1). Submitting hands off to the
 * library's hybrid search (`/app/library?q=…`) rather than searching in place —
 * results have a home already, and the dashboard stays a launchpad.
 *
 * `/` focuses it, matching the library's keyboard habit; the shortcut is ignored
 * while another field/editor has focus so it can't swallow real typing.
 */
export function Omnibox({ className }: { className?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Prefetch the destination so the jump after Enter is instant.
  useEffect(() => {
    router.prefetch("/app/library");
  }, [router]);

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = query.trim();
        router.push(trimmed ? searchHref(trimmed) : "/app/library");
      }}
      className={cn("flex items-center gap-2 rounded-xl border bg-card p-2 shadow-sm", className)}
    >
      <div className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your bookmarks and sessions…"
          aria-label="Search bookmarks and sessions"
          className="h-10 border-0 bg-transparent pl-9 shadow-none focus-visible:ring-0 md:text-base"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground sm:block">
          /
        </kbd>
      </div>
      {/* Ask AI is the PAGE's one solid button, and search is a ghost: Enter in
          the field is the real search gesture (the `/` hint above says how to get
          there), so the button is a fallback affordance, not a competing CTA.
          Two solid buttons side by side read as a choice you have to make. */}
      {/* aria-label, not just the label span: below sm both buttons are
          icon-only, and an icon with an aria-hidden glyph has no name at all. */}
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        className="h-9 shrink-0"
        aria-label="Search"
        title="Search"
      >
        <Search aria-hidden />
        <span className="hidden sm:inline">Search</span>
      </Button>
      {/* Opens the library's docked chat, EMPTY — it never auto-sends the box's
          text (that behavior burned a turn on a question nobody asked). */}
      <Button asChild size="sm" className="h-9 shrink-0">
        <Link href={askAiHref()} aria-label="Ask AI" title="Ask AI">
          <Sparkles aria-hidden />
          <span className="hidden sm:inline">Ask AI</span>
        </Link>
      </Button>
    </form>
  );
}
