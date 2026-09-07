import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLATFORMS, downloadAnchor, getPlatform } from "@/lib/platforms";
import { PlatformMarquee } from "./marquee";
import { PlatformActionButton } from "./platform-action";
import { PlatformIcon } from "./platform-icon";
import { ReleasesProvider } from "./releases-provider";
import { Reveal } from "./reveal";
import { StatusBadge } from "./status-badge";
import { display, glass, mono, SectionHead } from "./primitives";

/**
 * The launch section: every client with its real availability, straight from
 * lib/platforms.ts. Download buttons are release-record aware (a published
 * record from Settings → Releases wins over the static tag URL), and anything
 * not downloadable yet points into its card on /download rather than at a
 * store URL that 404s.
 */
export function Platforms() {
  const web = getPlatform("web");
  const clients = PLATFORMS.filter((p) => p.id !== "web");

  return (
    <ReleasesProvider>
      <section
        id="platforms"
        className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-20 sm:py-24"
      >
        <Reveal>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <SectionHead
              eyebrow="one library, every screen"
              title="Save here, find it there."
              sub="The same bookmarks and the same search, wherever you save or look them up. The Mac and Android apps download today; the store listings are on their way."
            />
            <a
              href="/download"
              className={cn(
                mono,
                "group inline-flex shrink-0 items-center gap-1.5 self-start text-sm font-medium text-foreground transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm sm:self-auto",
              )}
            >
              All downloads &amp; install steps
              <ArrowRight
                className="size-3.5 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </a>
          </div>
        </Reveal>

        <div className="mt-12">
          <PlatformMarquee />
        </div>

        {/* Web app — the primary surface, featured full-width. */}
        <Reveal className="mt-10">
          <div
            className={cn(
              "flex flex-col items-start gap-5 rounded-2xl p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-8",
              glass,
            )}
          >
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background/50">
              <PlatformIcon icon={web.icon} className="size-7 text-foreground" />
            </span>
            <div className="flex-1">
              <h3 className={cn(display, "text-xl font-semibold tracking-tight")}>{web.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {web.blurb} Browse, search, chat, and pick up the tabs still open on your
                other devices — and add it to your phone&rsquo;s home screen as an app.
              </p>
            </div>
            <PlatformActionButton entry={web} className="shrink-0" />
          </div>
        </Reveal>

        <Reveal
          selector="[data-reveal-item]"
          className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {clients.map((p) => (
            <article
              key={p.id}
              data-reveal-item
              className={cn(
                glass,
                "group/card flex flex-col gap-4 rounded-2xl p-6 transition-[border-color,transform] hover:border-border",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <PlatformIcon icon={p.icon} className="size-7 text-foreground" />
                {p.badge && <StatusBadge status={p.status}>{p.badge}</StatusBadge>}
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-medium tracking-tight">{p.name}</h3>
                <p className="text-sm text-muted-foreground">{p.blurb}</p>
              </div>
              <div className="mt-auto flex flex-col gap-3 pt-2">
                <PlatformActionButton entry={p} compact reserveCaption />
                <a
                  href={downloadAnchor(p.id)}
                  className={cn(
                    mono,
                    "group inline-flex w-fit items-center gap-1 rounded-sm text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  )}
                >
                  How to install
                  <ArrowRight
                    className="size-3 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </a>
              </div>
            </article>
          ))}
        </Reveal>
      </section>
    </ReleasesProvider>
  );
}
