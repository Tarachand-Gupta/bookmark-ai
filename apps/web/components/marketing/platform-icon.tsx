import { Apple, Chrome, Compass, Flame, Globe, Monitor, Smartphone } from "lucide-react";
import type { PlatformIcon as IconKey } from "@/lib/platforms";

const ICONS: Record<IconKey, React.ElementType> = {
  chrome: Chrome,
  firefox: Flame,
  safari: Compass,
  macos: Monitor,
  ios: Apple,
  android: Smartphone,
  web: Globe,
};

/** The lucide glyph for a platform's `icon` key (config stays icon-library-free). */
export function PlatformIcon({
  icon,
  className,
  strokeWidth = 1.5,
}: {
  icon: IconKey;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = ICONS[icon];
  return <Icon className={className} strokeWidth={strokeWidth} aria-hidden />;
}
