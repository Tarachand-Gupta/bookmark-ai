"use client";

import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { ChevronRight, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

/** The active facet shown as the second breadcrumb segment. */
export interface HeaderCrumb {
  label: string;
  Icon: React.ElementType;
}

export interface LibraryHeaderProps {
  /** Breadcrumb root — "All bookmarks" (or "Sessions"). */
  title: string;
  /** Active facet (category/browser/device/day); null at the root. */
  crumb?: HeaderCrumb | null;
  /** Clicking the root while a facet is active clears it. */
  onRootClick?: () => void;
  query: string;
  /** True while the AI chat panel is open. */
  aiActive: boolean;
  onQueryChange: (q: string) => void;
  onAskAi: () => void;
}

/**
 * Sticky top bar: sidebar trigger, active-view title, search, the standalone
 * Ask AI button, and the Clerk account control. Typing searches full-text
 * live (with an in-box clear ×); Ask AI opens the chat panel — it is its own
 * surface, deliberately not a search-box mode. The title always names the
 * selected view — search state is presented in the content area, never here.
 */
export function LibraryHeader({
  title,
  crumb,
  onRootClick,
  query,
  aiActive,
  onQueryChange,
  onAskAi,
}: LibraryHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 hidden !h-4 sm:block" />
      {/* Breadcrumb: root view, then the active facet with its icon — so a
          category/browser/device view always says where you are. */}
      <nav aria-label="Breadcrumb" className="mr-auto flex min-w-0 items-center gap-1">
        {crumb ? (
          <button
            type="button"
            onClick={onRootClick}
            className="shrink-0 truncate text-sm text-muted-foreground transition-colors hover:text-foreground sm:text-base"
          >
            {title}
          </button>
        ) : (
          <h1 className="truncate text-sm font-medium sm:text-base">{title}</h1>
        )}
        {crumb && (
          <>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium sm:text-base">
              <crumb.Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{crumb.label}</span>
            </span>
          </>
        )}
      </nav>

      <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto">
        <div className="relative flex-1 sm:w-80 sm:flex-none">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search bookmarks & sessions…"
            className={cn("h-9 pl-8", query ? "pr-8" : "pr-3")}
            aria-label="Search bookmarks and sessions"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>

        <Button
          size="sm"
          variant={aiActive ? "default" : "outline"}
          className="h-9"
          onClick={onAskAi}
          aria-pressed={aiActive}
        >
          <Sparkles aria-hidden />
          <span className="hidden sm:inline">Ask AI</span>
        </Button>
      </div>

      <ThemeToggle />
      <AuthControls />
    </header>
  );
}

/**
 * Clerk account control: Sign in / Sign up (signed out) or the UserButton
 * (signed in). Uses the client-safe `useUser` hook — this file is a client
 * component, so the server-only `Show` component can't be used here — and
 * renders a placeholder until Clerk loads to avoid a layout shift.
 */
function AuthControls() {
  const { isLoaded, isSignedIn } = useUser();

  return (
    <div className="flex shrink-0 items-center">
      {!isLoaded ? (
        <div className="size-8 animate-pulse rounded-full bg-muted" aria-hidden />
      ) : isSignedIn ? (
        <UserButton />
      ) : (
        <div className="flex items-center gap-1.5">
          <SignInButton mode="modal">
            <Button size="sm" variant="ghost" className="h-9">
              Sign in
            </Button>
          </SignInButton>
          <SignUpButton mode="modal">
            <Button size="sm" variant="outline" className="hidden h-9 sm:inline-flex">
              Sign up
            </Button>
          </SignUpButton>
        </div>
      )}
    </div>
  );
}
