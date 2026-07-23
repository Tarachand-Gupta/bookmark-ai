/**
 * Fixed ambient background. The design language here is LIGHT + BLUR, not a
 * chromatic accent — so this is fully monochrome: two soft light blooms that
 * drift slowly, over a faint graph-paper grid (the visual rhyme for "order").
 * All motion lives in globals.css keyframes and is gated behind
 * prefers-reduced-motion, so a reduced-motion viewer sees a calm static field.
 */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Graph-paper grid — near-black on light, near-white on dark. Masked so
          it fades toward the edges and never reads as a hard tiled texture. */}
      <div
        className="marketing-grid absolute inset-0 text-foreground opacity-[0.04] dark:opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "58px 58px",
          maskImage:
            "radial-gradient(ellipse 100% 70% at 50% 0%, black 20%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 100% 70% at 50% 0%, black 20%, transparent 80%)",
        }}
      />

      {/* Primary light bloom — a slow drift from upper-right. */}
      <div
        className="marketing-aurora absolute right-[-10rem] top-[-16rem] size-[46rem] rounded-full opacity-[0.5] blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, rgb(0 0 0 / 0.06) 0%, transparent 68%)",
        }}
      />
      <div
        className="marketing-aurora-alt absolute left-[-14rem] top-[10rem] size-[40rem] rounded-full opacity-[0.55] blur-[130px]"
        style={{
          background:
            "radial-gradient(circle, rgb(0 0 0 / 0.05) 0%, transparent 70%)",
        }}
      />

      {/* Dark-mode counterparts: the blooms invert to soft white light. */}
      <div
        className="marketing-aurora absolute right-[-10rem] top-[-16rem] hidden size-[46rem] rounded-full opacity-[0.14] blur-[120px] dark:block"
        style={{
          background:
            "radial-gradient(circle, rgb(255 255 255 / 0.9) 0%, transparent 66%)",
        }}
      />
      <div
        className="marketing-aurora-alt absolute left-[-14rem] top-[12rem] hidden size-[40rem] rounded-full opacity-[0.09] blur-[130px] dark:block"
        style={{
          background:
            "radial-gradient(circle, rgb(255 255 255 / 0.85) 0%, transparent 70%)",
        }}
      />

      {/* Bottom vignette so sections lower on the page sit on calmer ground. */}
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}
