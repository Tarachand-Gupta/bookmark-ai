"use client";
import { useAccountDetails } from "./account-details-provider";

import { usePathname, useSearchParams } from "next/navigation";
import { useUser } from "@/lib/auth";
import { ChevronRight, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
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
  query?: string;
  /** True while the AI chat panel is open. */
  aiActive?: boolean;
  /**
   * Omit to render the bar WITHOUT the search box and Ask AI button — that's how
   * the dashboard reuses this header, since search there lives in the page's own
   * omnibox and duplicating it in the chrome would be two search fields on one
   * screen. The library always passes it.
   */
  onQueryChange?: (q: string) => void;
  onAskAi?: () => void;
  onOpenAccount?: () => void;
  searchPlaceholder?: string;
}

/**
 * Sticky top bar: sidebar trigger, active-view title, search, the standalone
 * Ask AI button, and the account control. Typing searches full-text
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
  onOpenAccount,
  searchPlaceholder = "Search bookmarks & sessions…",
}: LibraryHeaderProps) {
  return (
    // px-3 at mobile widths: the search row wraps onto its own line there, and
    // 16px of padding either side was squeezing it against the Ask AI button.
    <header className="@container/header sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
      <SidebarTrigger className="-ml-1 size-11 md:size-8 [@media(pointer:coarse)]:size-11" />
      <Separator orientation="vertical" className="mr-1 hidden !h-4 sm:block" />
      {/* Breadcrumb: root view, then the active facet with its icon — so a
          category/browser/device view always says where you are. */}
      <nav aria-label="Breadcrumb" className="mr-auto flex min-w-0 flex-1 items-center gap-1">
        {crumb ? (
          <button
            type="button"
            onClick={onRootClick}
            className="cursor-pointer min-h-11 shrink-0 truncate rounded-sm text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8 [@media(pointer:coarse)]:min-h-11 text-muted-foreground transition-colors hover:text-foreground sm:text-base"
          >
            {title}
          </button>
        ) : (
          <h1 className="truncate text-sm font-medium sm:text-base" title={title}>{title}</h1>
        )}
        {crumb && (
          <>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <h1 aria-current="page" className="flex min-w-0 items-center gap-1.5 text-sm font-medium sm:text-base">
              <crumb.Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{crumb.label}</span>
            </h1>
          </>
        )}
      </nav>

      {/* Search + Ask AI: rendered only when the host page wired them up (the
          dashboard doesn't — it has its own omnibox). */}
      {onQueryChange && (
        <div className="order-last flex w-full min-w-0 items-center gap-2 @min-[40rem]/header:order-none @min-[40rem]/header:w-[min(52%,28rem)]">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query ?? ""}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={searchPlaceholder}
              className={cn("h-11 pl-8 md:h-9 [@media(pointer:coarse)]:h-11", query ? "pr-12 md:pr-10 [@media(pointer:coarse)]:pr-12" : "pr-3")}
              aria-label={searchPlaceholder === "Search this folder…" ? "Search this folder" : "Search bookmarks and sessions"}
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange("")}
                aria-label="Clear search"
                className="cursor-pointer absolute right-1.5 top-1/2 -translate-y-1/2 flex size-11 items-center justify-center rounded-md text-muted-foreground md:size-8 [@media(pointer:coarse)]:size-11 transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>

          <Button
            size="sm"
            variant={aiActive ? "default" : "outline"}
            className="h-11 md:h-9 [@media(pointer:coarse)]:h-11"
            aria-label="Ask AI"
            onClick={onAskAi}
            aria-pressed={aiActive}
          >
            <Sparkles aria-hidden />
            <span className="hidden sm:inline">Ask AI</span>
          </Button>
        </div>
      )}

      <AuthControls onOpenAccount={onOpenAccount} />
    </header>
  );
}

/** Open account settings over the current page. The URL remains shareable,
 * while local state opens the dialog without waiting for navigation or data. */
function AuthControls({onOpenAccount}: {onOpenAccount?: () => void}) {
  const details = useAccountDetails();
  const { isLoaded, isSignedIn, user } = useUser();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Built from the CURRENT location, not a fixed "/app?settings=account": the
  // library keeps its facets, search and the Ask AI dock in the query string, and
  // navigating to a bare path would silently reset the view behind the dialog.
  // Works from Home too — `settings` was dropped from middleware.ts's
  // LEGACY_LIBRARY_PARAMS so `/app?settings=account` no longer bounces to the
  // grid; the dashboard opens the modal where you already are.
  const params = new URLSearchParams(searchParams);
  params.set("settings", "account");
  const userProfileUrl = `${pathname}?${params}`;

  return (
    <div className="flex shrink-0 items-center">
      {!isLoaded ? (
        <div className="size-8 animate-pulse rounded-full bg-muted" aria-hidden />
      ) : isSignedIn ? (
        <a href={userProfileUrl} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenAccount?.(); window.history.pushState(null, "", userProfileUrl); }} className="flex size-11 items-center justify-center rounded-full border bg-muted text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-9 [@media(pointer:coarse)]:size-11" aria-label="Manage account"><Avatar className="size-9"><AvatarImage src={user?.imageUrl || undefined} alt="" /><AvatarFallback>{user?.firstName?.slice(0, 1) || details?.me?.name?.slice(0, 1) || "A"}</AvatarFallback></Avatar></a>
      ) : (
        <div className="flex items-center gap-1.5"><a href="/sign-in" className="text-sm">Sign in</a><a href="/sign-up" className="text-sm">Sign up</a></div>
      )}
    </div>
  );
}
