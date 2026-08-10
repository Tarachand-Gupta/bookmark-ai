import { Laptop, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { mono } from "./primitives";

// The big feature-card animation lives in its own island now — the extension
// toggle → app → live tabs journey, mirroring the hero. Re-exported here so the
// features grid's import path (`./live-tabs`) stays put.
export { LiveTabsDemo } from "@bookmark-ai/ui/demos/live-tabs-demo";

/**
 * Scoped keyframes for the hero's live-sync strip. Can't touch globals.css from
 * here, and these are local to this island anyway — a duplicate @keyframes block
 * is identical and harmless.
 */
const KEYFRAMES = `
@keyframes lt-travel {
  0%   { transform: translateX(-10%); opacity: 0; }
  15%  { opacity: 1; }
  85%  { opacity: 1; }
  100% { transform: translateX(1000%); opacity: 0; }
}
@media (prefers-reduced-motion: no-preference) {
  .lt-wire-pulse { animation: lt-travel 2.4s ease-in-out infinite; }
}
`;

/** The pulsing "live" dot — a solid core with an expanding ping ring. */
function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      <span className="absolute inset-0 rounded-full bg-emerald-500/70 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
    </span>
  );
}

/**
 * The hero's compact live-sync strip: a single glass row that says, at a glance,
 * "your laptop's tabs are on your phone, live." Self-contained; the traveling
 * pulse and live dot are the only motion.
 */
export function LiveWire() {
  return (
    <div
      aria-hidden
      className={cn(
        mono,
        "pointer-events-none mt-8 inline-flex select-none items-center gap-2.5 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur-sm",
      )}
    >
      <style>{KEYFRAMES}</style>
      <span className="flex items-center gap-1.5">
        <Laptop className="size-3.5 text-foreground/70" aria-hidden />
        <span className="text-foreground/70">9 tabs</span>
      </span>
      <span className="relative flex h-px w-8 items-center">
        <span className="h-px w-full bg-gradient-to-r from-border/40 to-emerald-500/70" />
        <span className="lt-wire-pulse absolute left-0 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-emerald-500 shadow-[0_0_6px_1px_rgb(16_185_129/0.7)]" />
      </span>
      <span className="flex items-center gap-1.5">
        <Smartphone className="size-3.5 text-foreground/70" aria-hidden />
        <span className="text-foreground/70">iPhone</span>
      </span>
      <span className="flex items-center gap-1 font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
        <LiveDot />
        live
      </span>
    </div>
  );
}
