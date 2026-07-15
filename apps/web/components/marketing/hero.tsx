import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { HeroTabField } from "./hero-tab-field";
import { btnOutline, btnPrimary, display, Eyebrow, mono } from "./primitives";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-y-14 px-6 pb-20 pt-14 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-x-10 lg:pb-28 lg:pt-24">
        {/* Left — the argument. */}
        <div className="flex max-w-xl flex-col justify-center">
          <Eyebrow>every tab · every device</Eyebrow>

          <h1
            className={cn(
              display,
              "mt-6 text-balance text-[2.9rem] font-semibold leading-[0.98] tracking-[-0.03em] sm:text-6xl lg:text-[4.15rem]",
            )}
          >
            Turn tab chaos into searchable memory.
          </h1>

          <p className="mt-6 max-w-lg text-base text-muted-foreground sm:text-lg">
            Save any page from any browser or device. Bookmark AI reads each one,
            files it under a category with tags, and embeds it — so you find things
            by meaning, not just the words you remember.
          </p>

          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <a href="/sign-up" className={btnPrimary}>
              Get started — free
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </a>
            <a href="/app" className={btnOutline}>
              Open the app
            </a>
          </div>

          <p className={cn(mono, "mt-8 text-xs text-muted-foreground")}>
            free &amp; open source
            <span aria-hidden className="mx-2 text-border">
              /
            </span>
            categorized by Gemini
          </p>
        </div>

        {/* Right — the proof: the chaos-to-order tab field, bleeding off-edge. */}
        <div className="relative min-w-0 lg:-mr-[7vw] lg:pl-4">
          <HeroTabField />
        </div>
      </div>
    </section>
  );
}
