import type { ElementType } from "react";
import {
  Apple,
  Chrome,
  Compass,
  Flame,
  Globe,
  Laptop,
  Monitor,
  MonitorSmartphone,
  Smartphone,
  Tablet,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Single source of truth for the browser / device-type icon glyphs used across
 * the library views (the live "open tabs" header AND saved-session rows). Kept
 * here so both surfaces render the same visual language instead of drifting.
 * Unknown keys fall back to a globe / generic device at the call site.
 */
export const BROWSER_ICONS: Record<string, ElementType> = {
  chrome: Chrome,
  firefox: Flame,
  safari: Compass,
  edge: Globe,
  arc: Globe,
  other: Globe,
};

export const DEVICE_ICONS: Record<string, ElementType> = {
  desktop: Monitor,
  laptop: Laptop,
  mobile: Smartphone,
  tablet: Tablet,
  other: MonitorSmartphone,
};

/**
 * Map a free-form OS string (the extension stores whatever `navigator` reports —
 * "macOS", "Windows", "iOS", "Chrome OS", …) to a friendly label + icon. Returns
 * null for anything we can't confidently identify, so callers OMIT the badge
 * rather than render junk. lucide only ships an Apple glyph, so non-Apple OSes
 * reuse the neutral monitor/phone icons — the LABEL carries the identity.
 */
export function osBadge(os: string | null | undefined): { Icon: ElementType; label: string } | null {
  const s = (os ?? "").toLowerCase().trim();
  if (!s) return null;
  if (/iphone|ipad|ios/.test(s)) return { Icon: Apple, label: "iOS" };
  if (/mac|os ?x|darwin/.test(s)) return { Icon: Apple, label: "Mac" };
  if (/win/.test(s)) return { Icon: Monitor, label: "Windows" };
  if (/android/.test(s)) return { Icon: Smartphone, label: "Android" };
  if (/cros|chrome ?os|chromium ?os/.test(s)) return { Icon: Chrome, label: "ChromeOS" };
  if (/linux|ubuntu|fedora|debian/.test(s)) return { Icon: Monitor, label: "Linux" };
  return null;
}

const BROWSER_LABELS: Record<string, string> = {
  chrome: "Chrome",
  firefox: "Firefox",
  safari: "Safari",
  edge: "Edge",
  arc: "Arc",
};

interface Badge {
  Icon: ElementType;
  label: string;
}

function Segment({ Icon, label }: Badge) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

/**
 * Muted identifier badges for a saved session — "🍎 Mac · Chrome" — derived from
 * its stored `os` / `device` / `browser` fields, matching the live-view header's
 * visual language. Prefers the OS badge; when the OS is unknown/absent (older
 * sessions saved before OS capture) it falls back to the device-TYPE badge so a
 * laptop still reads as "Laptop". Everything set to the `"other"` default is
 * dropped, and if nothing is identifiable the component renders nothing.
 */
export function SessionIdentity({
  os,
  browser,
  device,
  className,
}: {
  os?: string | null;
  browser?: string | null;
  device?: string | null;
  className?: string;
}) {
  const segments: Badge[] = [];

  // First segment: the machine — OS when we can name it, else the device type.
  const osSeg = osBadge(os);
  if (osSeg) {
    segments.push(osSeg);
  } else if (device && device !== "other") {
    const label = device.charAt(0).toUpperCase() + device.slice(1);
    segments.push({ Icon: DEVICE_ICONS[device] ?? MonitorSmartphone, label });
  }

  // Second segment: the browser.
  if (browser && browser !== "other") {
    segments.push({ Icon: BROWSER_ICONS[browser] ?? Globe, label: BROWSER_LABELS[browser] ?? browser });
  }

  if (segments.length === 0) return null;

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      {segments.map((seg, i) => (
        <span key={seg.label} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          <Segment {...seg} />
        </span>
      ))}
    </span>
  );
}
