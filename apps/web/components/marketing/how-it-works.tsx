import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { display, mono, SectionHead } from "./primitives";

const STEPS = [
  {
    n: "01",
    title: "Save from anywhere",
    body: "One click in the extension, the mobile share sheet, or a pasted URL — from any browser, phone, or the desktop app.",
  },
  {
    n: "02",
    title: "AI enriches it",
    body: "The page is scraped, then Gemini writes a clean title, picks a category and tags, and embeds it for meaning-based search.",
  },
  {
    n: "03",
    title: "Find it by meaning",
    body: "Browse by category or search by meaning — on the web, on mobile, in the desktop app, or straight from the extension.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
      <Reveal>
        <SectionHead
          eyebrow="how it works"
          title="From tab to searchable in seconds."
        />
      </Reveal>

      <div className="relative mt-14">
        {/* The pipeline rail — order is real information here, so it's drawn. */}
        <div
          aria-hidden
          className="absolute left-0 right-0 top-5 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block"
        />
        <Reveal selector="[data-reveal-item]">
          <ol className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((s) => (
              <li key={s.n} data-reveal-item className="relative flex flex-col">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      mono,
                      "flex size-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card/70 text-sm font-semibold tabular-nums backdrop-blur-sm",
                    )}
                  >
                    {s.n}
                  </span>
                  <span aria-hidden className="h-px flex-1 bg-border/60 md:hidden" />
                </div>
                <h3 className={cn(display, "mt-5 text-xl font-semibold tracking-tight")}>
                  {s.title}
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
