import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLAN_FEATURES } from "@/lib/plan";
import { Reveal } from "./reveal";
import { btnPrimary, display, glass, mono, SectionHead } from "./primitives";

/**
 * Pricing. ONE card, two halves, one honest statement: everything the product
 * does today is free, and Pro is a plate that hasn't been developed yet.
 *
 * The left half is lit — the glass surface, a display-size `$0`, the plan's
 * four lines (from PLAN_FEATURES, the same source Settings → Account reads, so
 * the copy can't drift), and the one CTA. The right half is deliberately
 * DORMANT: a faint dot grid (the backdrop's graph paper, unwritten) with a slow
 * sheen passing over it every few seconds, and a single mono label. No price,
 * no feature list, no waitlist — silence is the message.
 */
export function Pricing() {
  const free = PLAN_FEATURES.free;

  return (
    <section
      id="pricing"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-20 sm:py-24"
    >
      <Reveal>
        <SectionHead
          eyebrow="pricing"
          title="All of it, free."
          sub="Everything Bookmark AI does today is on the Free plan — the whole product, not a trial."
        />
      </Reveal>

      <Reveal className="mt-12">
        <div
          className={cn(
            glass,
            "grid overflow-hidden rounded-3xl md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]",
          )}
        >
          {/* ── Free: the lit half ─────────────────────────────────────── */}
          <div className="flex flex-col p-7 sm:p-10">
            <p
              className={cn(
                mono,
                "text-[0.7rem] font-medium uppercase tracking-[0.28em] text-muted-foreground",
              )}
            >
              {free.name}
            </p>

            <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span
                className={cn(
                  display,
                  "text-6xl font-semibold leading-none tracking-[-0.04em] sm:text-7xl",
                )}
              >
                ${free.price}
              </span>
              <span
                className={cn(
                  display,
                  "text-2xl font-medium tracking-[-0.01em] text-muted-foreground sm:text-3xl",
                )}
              >
                everything, today
              </span>
            </div>

            <ul className="mt-8 space-y-3">
              {free.features.map((f) => (
                <li key={f.key} className="flex items-start gap-3 text-sm sm:text-[15px]">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.07] text-foreground dark:bg-foreground/[0.1]"
                  >
                    <Check className="size-3" strokeWidth={2.5} />
                  </span>
                  <span className="leading-6">{f.label}</span>
                </li>
              ))}
            </ul>

            <div className="mt-10">
              <a href="/sign-up" className={btnPrimary}>
                Get started
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </a>
            </div>
          </div>

          {/* ── Pro: the dormant half ──────────────────────────────────── */}
          <div
            aria-label="Pro plan: coming soon"
            className="relative flex min-h-[11rem] flex-col border-t border-border/60 bg-muted/25 md:min-h-0 md:border-l md:border-t-0 dark:bg-black/20"
          >
            <div aria-hidden className="pricing-dots pointer-events-none absolute inset-0" />
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="pricing-sheen absolute inset-y-0 left-0 w-1/3" />
            </div>

            <p
              className={cn(
                mono,
                "relative px-7 pt-7 text-[0.7rem] font-medium uppercase tracking-[0.28em] text-muted-foreground/60 sm:px-10 sm:pt-10",
              )}
            >
              pro
            </p>
            <div className="relative flex flex-1 items-center justify-center px-7 pb-7 pt-4 sm:px-10 sm:pb-10">
              <span
                className={cn(
                  mono,
                  "rounded-full border border-dashed border-border px-4 py-1.5 text-xs uppercase tracking-[0.22em] text-muted-foreground",
                )}
              >
                coming soon
              </span>
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal>
        <p
          className={cn(
            mono,
            "mt-5 text-center text-[11px] text-muted-foreground/70",
          )}
        >
          Fair-use limits apply · Your data lives in your own database
        </p>
      </Reveal>
    </section>
  );
}
