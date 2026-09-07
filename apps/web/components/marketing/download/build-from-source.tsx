import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLATFORMS, REPO_URL } from "@/lib/platforms";
import { PlatformIcon } from "../platform-icon";
import { glass, mono, SectionHead } from "../primitives";
import { StatusBadge } from "../status-badge";
import { CommandBlock } from "./command-block";

/**
 * The from-source path for every platform that has one — the only route to
 * Safari and iOS today, and a valid one for the Mac and Android apps too.
 * Recipes are the short, verified commands; the long form lives in the repo
 * docs each block links to, so this page can't drift from them.
 */
export function BuildFromSource() {
  const entries = PLATFORMS.filter((p) => p.source);
  return (
    <section id="source" className="scroll-mt-24">
      <SectionHead
        eyebrow="build from source"
        title="Don't want to wait? Build it yourself."
        sub="Everything is open source. Each recipe below is the real command sequence, verified on macOS — the full walkthroughs are in the repository."
      />
      <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {entries.map((p) => (
          <article
            key={p.id}
            id={`source-${p.id}`}
            className={cn(glass, "flex scroll-mt-24 flex-col gap-4 rounded-2xl p-6")}
          >
            <div className="flex items-center gap-3">
              <PlatformIcon icon={p.icon} className="size-5 text-foreground" />
              <h3 className="text-base font-medium tracking-tight">{p.name}</h3>
              {p.badge && (
                <StatusBadge status={p.status} className="ml-auto">
                  {p.badge}
                </StatusBadge>
              )}
            </div>
            <p className={cn(mono, "text-[11px] text-muted-foreground")}>
              <span className="uppercase tracking-[0.18em]">needs</span>
              <span aria-hidden className="mx-1.5 text-border">
                /
              </span>
              {p.source!.requirements}
            </p>
            <CommandBlock commands={p.source!.commands} />
            <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              {p.source!.notes.map((n, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden className="mt-2.5 size-1 shrink-0 rounded-full bg-border" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
            <a
              href={p.source!.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(
                mono,
                "group mt-auto inline-flex w-fit items-center gap-1.5 rounded-sm pt-1 text-xs font-medium text-foreground transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              Full walkthrough in the repo
              <ArrowUpRight
                className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                aria-hidden
              />
            </a>
          </article>
        ))}
      </div>
      <p className={cn(mono, "mt-6 text-[11px] text-muted-foreground/80")}>
        Source: {REPO_URL.replace("https://", "")}
      </p>
    </section>
  );
}
