"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

/** The tour screenshots that ship a light + dark variant under /img/tour/. */
export type ThemeShotName = "library" | "saved-sessions" | "live-sessions";

export interface ThemeShotProps {
  /** Base name; resolves to `/img/tour/<name>-<light|dark>.jpg`. */
  name: ThemeShotName;
  /** Non-visual description for assistive tech. */
  alt: string;
  className?: string;
}

/**
 * A real production screenshot inside a rounded, bordered frame. Shows the
 * `-light` asset by default and swaps to `-dark` when the app's resolved theme
 * is dark. Theme is only knowable client-side (next-themes), so the first paint
 * is the light variant and the dark one lands after mount — same idiom as
 * `ThemeToggle`. The frame is aria-hidden with the alt text carried separately
 * so screen readers get the description without the decorative chrome.
 */
export function ThemeShot({ name, alt, className }: ThemeShotProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === "dark";
  const src = `/img/tour/${name}-${dark ? "dark" : "light"}.jpg`;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-muted/30 shadow-sm",
        className,
      )}
    >
      <Image
        src={src}
        alt={alt}
        width={1200}
        height={800}
        unoptimized
        className="h-auto max-h-56 w-full object-cover object-top"
      />
    </div>
  );
}
