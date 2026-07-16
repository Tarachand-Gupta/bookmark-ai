import { Bookmark, Chrome, Compass, Folder, Layers, Library, Search, Settings, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { mono } from "../primitives";
import { BROWSER_FACETS, CATEGORY_FACETS, LIBRARY, QUERY, TOTAL, type DemoCard } from "./data";

/**
 * The library, restaged.
 *
 * Mirrors `components/library/*`: the sidebar's brand block + "All bookmarks" /
 * "Sessions" / Categories facets, the header's search field and Ask AI button,
 * and the card grid.
 *
 * Its default DOM is the *last* frame of the film — search run, results
 * filtered. Reduced-motion visitors and anyone whose JS never arrives get this
 * as a finished picture; the timeline's job is to rewind it to beat 1 and play
 * forward into it. That inversion is why nothing here starts hidden "pending"
 * an animation.
 */
export function DashboardMock() {
  return (
    <div
      data-demo="dashboard"
      style={{ willChange: "opacity" }}
      className="absolute inset-0 flex overflow-hidden bg-background/40"
    >
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header />

        <div className="min-h-0 flex-1 px-[1em] pt-[0.85em]">
          <MetaRow />
          <div className="mt-[0.7em] grid grid-cols-1 gap-[0.6em] @sm:grid-cols-2">
            {LIBRARY.map((card) => (
              <Card key={card.title} card={card} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="hidden w-[26%] shrink-0 flex-col border-r border-border/60 bg-foreground/[0.02] px-[0.55em] py-[0.6em] @md:flex dark:border-white/[0.07] dark:bg-white/[0.02]">
      <div className="flex items-center gap-[0.45em] px-[0.25em]">
        <span className="flex size-[1.4em] items-center justify-center rounded-[0.35em] bg-primary text-primary-foreground">
          <Bookmark className="size-[0.75em]" aria-hidden />
        </span>
        <span className="grid min-w-0 leading-tight">
          <span className="truncate text-[0.65em] font-semibold">Bookmark AI</span>
          <span className={cn(mono, "truncate text-[0.5em] text-muted-foreground")}>
            {TOTAL} saved
          </span>
        </span>
      </div>

      <div className="mt-[0.9em] space-y-[0.1em]">
        <NavRow icon={Library} label="All bookmarks" badge={String(TOTAL)} active />
        <NavRow icon={Layers} label="Sessions" badge="2" />
      </div>

      <FacetGroup label="Categories">
        {CATEGORY_FACETS.map((f) => (
          <NavRow key={f.name} icon={Folder} label={f.name} badge={String(f.count)} />
        ))}
      </FacetGroup>

      <FacetGroup label="Browsers">
        {BROWSER_FACETS.map((f) => (
          <NavRow
            key={f.name}
            icon={f.name === "Chrome" ? Chrome : Compass}
            label={f.name}
            badge={String(f.count)}
          />
        ))}
      </FacetGroup>

      {/* The real sidebar pins Settings to the bottom; so does this one — it's
          what stops the column reading as half-empty. */}
      <div className="mt-auto pt-[0.6em]">
        <NavRow icon={Settings} label="Settings" badge="" />
      </div>
    </aside>
  );
}

function FacetGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <p
        className={cn(
          mono,
          "mt-[0.85em] px-[0.4em] text-[0.5em] uppercase tracking-[0.14em] text-muted-foreground/70",
        )}
      >
        {label}
      </p>
      <div className="mt-[0.25em] space-y-[0.1em]">{children}</div>
    </>
  );
}

function NavRow({
  icon: Icon,
  label,
  badge,
  active,
}: {
  icon: React.ElementType;
  label: string;
  badge?: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-[0.45em] rounded-[0.35em] px-[0.4em] py-[0.3em]",
        active && "bg-foreground/[0.07] dark:bg-white/[0.09]",
      )}
    >
      <Icon
        className={cn("size-[0.7em] shrink-0", active ? "text-foreground" : "text-muted-foreground")}
        aria-hidden
      />
      <span
        className={cn(
          "truncate text-[0.6em]",
          active ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      {badge && (
        <span className={cn(mono, "ml-auto text-[0.5em] tabular-nums text-muted-foreground/70")}>
          {badge}
        </span>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="flex shrink-0 items-center gap-[0.5em] border-b border-border/60 px-[1em] py-[0.6em] dark:border-white/[0.07]">
      {/* Search field. A div, not an input — nothing in this scene is real, and
          a visitor clicking a field that does nothing is a bug, not a demo. */}
      <div
        data-demo="search-field"
        className="relative flex h-[1.9em] min-w-0 flex-1 items-center gap-[0.4em] rounded-[0.4em] border border-border/70 bg-background/70 px-[0.5em] dark:border-white/[0.1] dark:bg-black/30"
      >
        <span
          data-demo="search-ring"
          className="pointer-events-none absolute inset-[-0.12em] rounded-[0.5em] ring-2 ring-foreground/25 dark:ring-white/25"
        />
        <Search className="size-[0.7em] shrink-0 text-muted-foreground" aria-hidden />
        <div className="relative flex min-w-0 flex-1 items-center">
          <span
            data-demo="search-ph"
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center truncate text-[0.6em] text-muted-foreground opacity-0"
          >
            Search bookmarks &amp; sessions…
          </span>
          <span data-demo="search-text" className="truncate text-[0.6em] text-foreground">
            {QUERY}
          </span>
          <span
            data-demo="caret"
            className="ml-[0.05em] h-[0.85em] w-[0.06em] shrink-0 bg-foreground opacity-0"
          />
        </div>
      </div>

      <div className="flex h-[1.9em] shrink-0 items-center gap-[0.3em] rounded-[0.4em] border border-border/70 px-[0.55em] dark:border-white/[0.1]">
        <Sparkles className="size-[0.7em] text-foreground" aria-hidden />
        <span className="text-[0.6em] font-medium">Ask AI</span>
      </div>
    </div>
  );
}

/**
 * One slot, two states, stacked — so "All bookmarks" becoming "2 results"
 * costs a cross-fade instead of a reflow.
 */
function MetaRow() {
  return (
    <div className="relative h-[1.2em]">
      <div data-demo="meta-all" className="absolute inset-0 flex items-center gap-[0.4em] opacity-0">
        <span className="text-[0.65em] font-semibold tracking-tight">All bookmarks</span>
        <span className={cn(mono, "text-[0.55em] tabular-nums text-muted-foreground")}>
          {TOTAL} saved
        </span>
      </div>
      <div data-demo="meta-results" className="absolute inset-0 flex items-center gap-[0.4em]">
        <span className="text-[0.65em] font-semibold tracking-tight">2 results</span>
        <span
          className={cn(
            mono,
            "rounded-full border border-border/70 px-[0.4em] py-[0.05em] text-[0.48em] text-muted-foreground dark:border-white/15",
          )}
        >
          hybrid
        </span>
        <span className={cn(mono, "min-w-0 truncate text-[0.5em] text-muted-foreground/70")}>
          meaning · not keywords
        </span>
      </div>
    </div>
  );
}

function Card({ card }: { card: DemoCard }) {
  const dimmed = card.role === "other";
  return (
    <article
      data-demo="card"
      data-role={card.role}
      style={{ willChange: "transform, opacity" }}
      className={cn(
        "relative flex flex-col gap-[0.35em] rounded-[0.5em] border border-border/70 bg-card/60 p-[0.55em] backdrop-blur-sm",
        "shadow-[0_1px_0_0_rgb(255_255_255/0.5)_inset] dark:border-white/[0.09] dark:bg-white/[0.045]",
        "dark:shadow-[0_1px_0_0_rgb(255_255_255/0.06)_inset]",
        dimmed && "opacity-[0.22]",
      )}
    >
      {/* Search hit. Visible by default because the default frame *is* the result. */}
      {!dimmed && (
        <span
          data-demo="ring"
          className="pointer-events-none absolute inset-[-0.09em] rounded-[0.58em] ring-[0.09em] ring-foreground/35 dark:ring-white/40"
        />
      )}
      {card.role === "saved" && (
        <span
          data-demo="saved-flash"
          className="pointer-events-none absolute inset-0 rounded-[0.5em] bg-foreground/15 opacity-0 dark:bg-white/20"
        />
      )}

      <div className="flex items-center gap-[0.35em]">
        <span
          className={cn(
            mono,
            "flex size-[1.1em] shrink-0 items-center justify-center rounded-[0.25em] border border-border/60 bg-foreground/[0.06] text-[0.5em] font-semibold text-foreground/70",
          )}
        >
          {card.mark}
        </span>
        <span className={cn(mono, "truncate text-[0.5em] text-muted-foreground")}>
          {card.domain}
        </span>
      </div>

      <p className="line-clamp-2 text-[0.62em] font-medium leading-snug">{card.title}</p>

      <div className="mt-auto flex items-center gap-[0.35em] pt-[0.1em]">
        <span
          className={cn(
            mono,
            "rounded-full border border-border/60 bg-background/40 px-[0.4em] py-[0.05em] text-[0.45em] uppercase tracking-wide text-muted-foreground",
          )}
        >
          {card.cat}
        </span>
        <span className={cn(mono, "ml-auto text-[0.45em] text-muted-foreground/70")}>
          {card.when}
        </span>
      </div>
    </article>
  );
}
