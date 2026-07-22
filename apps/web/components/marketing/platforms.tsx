import {
  Apple,
  ArrowRight,
  ArrowUpRight,
  Chrome,
  Compass,
  Flame,
  Globe,
  Monitor,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PlatformMarquee } from "./marquee";
import { Reveal } from "./reveal";
import { btnPrimary, display, glass, mono, REPO, REPO_README, SectionHead } from "./primitives";

// Every client, with an honest availability state. Nothing here promises a
// store listing that doesn't exist yet.
const CLIENTS = [
  {
    icon: Chrome,
    name: "Chrome, Edge & Arc",
    blurb: "One-click save from the toolbar, plus full-tab sessions.",
    href: REPO,
    cta: "Build from source",
    caption: "Store release coming soon",
  },
  {
    icon: Compass,
    name: "Safari",
    blurb: "Native Web Extension for macOS Safari.",
    href: REPO_README,
    cta: "Build from source",
  },
  {
    icon: Flame,
    name: "Firefox",
    blurb: "Save and search without leaving Firefox.",
    href: REPO,
    cta: "Build from source",
    caption: "Store release coming soon",
  },
  {
    icon: Apple,
    name: "iOS & iPad",
    blurb: "Save and browse your library on iPhone and iPad.",
    href: REPO_README,
    cta: "Build from source",
  },
  {
    icon: Smartphone,
    name: "Android",
    blurb: "The same library and search on Android.",
    href: REPO,
    cta: "Build from source",
    caption: "Store release coming soon",
  },
  {
    icon: Monitor,
    name: "Desktop (macOS)",
    blurb: "A native menu-bar companion app for the Mac.",
    href: REPO,
    cta: "Build from source",
    caption: "Prebuilt binaries coming soon",
  },
];

export function Platforms() {
  return (
    <section id="platforms" className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-20 sm:py-24">
      <Reveal>
        <SectionHead
          eyebrow="one library, every screen"
          title="Save here, find it there."
          sub="The same bookmarks and the same search, wherever you save or look them up."
        />
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
            <Globe className="size-7 text-foreground" strokeWidth={1.5} aria-hidden />
          </span>
          <div className="flex-1">
            <h3 className={cn(display, "text-xl font-semibold tracking-tight")}>Web app</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Your full library in any browser — nothing to install. Browse, search,
              chat, and pick up the tabs still open on your other devices.
            </p>
          </div>
          <a href="/app" className={cn(btnPrimary, "shrink-0")}>
            Open app
            <ArrowRight className="size-4" aria-hidden />
          </a>
        </div>
      </Reveal>

      <Reveal
        selector="[data-reveal-item]"
        className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {CLIENTS.map((p) => (
          <div
            key={p.name}
            data-reveal-item
            className={cn(glass, "flex flex-col gap-4 rounded-2xl p-6")}
          >
            <p.icon className="size-7 text-foreground" strokeWidth={1.5} aria-hidden />
            <div className="space-y-1">
              <h3 className="text-base font-medium tracking-tight">{p.name}</h3>
              <p className="text-sm text-muted-foreground">{p.blurb}</p>
            </div>
            <div className="mt-auto space-y-1.5 pt-2">
              <a
                href={p.href}
                target="_blank"
                rel="noreferrer noopener"
                className={cn(
                  mono,
                  "group inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-muted-foreground",
                )}
              >
                {p.cta}
                <ArrowUpRight
                  className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  aria-hidden
                />
              </a>
              {p.caption && (
                <p className={cn(mono, "text-[11px] text-muted-foreground/70")}>
                  {p.caption}
                </p>
              )}
            </div>
          </div>
        ))}
      </Reveal>
    </section>
  );
}
