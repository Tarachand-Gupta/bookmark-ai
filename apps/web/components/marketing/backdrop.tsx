/**
 * Fixed ambient background. The design language here is LIGHT + BLUR, not a
 * chromatic accent — so this is fully monochrome: two soft light blooms that
 * drift slowly. The homepage's graph-paper texture is no longer drawn here — it
 * has been replaced by the interactive cube lattice (<CubesField />), whose idle
 * dashed outlines are the "order" motif now. All motion lives in globals.css
 * keyframes and is gated behind prefers-reduced-motion.
 */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
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
