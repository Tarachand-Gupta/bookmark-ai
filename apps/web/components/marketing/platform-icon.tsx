import {
  Chrome,
  Compass,
  Globe,
} from "lucide-react";
import type { PlatformIcon as IconKey } from "@/lib/platforms";

// Brand silhouettes from Simple Icons (CC0).
function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

function FirefoxMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M8.824 7.287c.008 0 .004 0 0 0zm-2.8-1.4c.006 0 .003 0 0 0zm16.754 2.161c-.505-1.215-1.53-2.528-2.333-2.943.654 1.283 1.033 2.57 1.177 3.53l.002.02c-1.314-3.278-3.544-4.6-5.366-7.477-.091-.147-.184-.292-.273-.446a3.545 3.545 0 01-.13-.24 2.118 2.118 0 01-.172-.46.03.03 0 00-.027-.03.038.038 0 00-.021 0l-.006.001a.037.037 0 00-.01.005L15.624 0c-2.585 1.515-3.657 4.168-3.932 5.856a6.197 6.197 0 00-2.305.587.297.297 0 00-.147.37c.057.162.24.24.396.17a5.622 5.622 0 012.008-.523l.067-.005a5.847 5.847 0 011.957.222l.095.03a5.816 5.816 0 01.616.228c.08.036.16.073.238.112l.107.055a5.835 5.835 0 01.368.211 5.953 5.953 0 012.034 2.104c-.62-.437-1.733-.868-2.803-.681 4.183 2.09 3.06 9.292-2.737 9.02a5.164 5.164 0 01-1.513-.292 4.42 4.42 0 01-.538-.232c-1.42-.735-2.593-2.121-2.74-3.806 0 0 .537-2 3.845-2 .357 0 1.38-.998 1.398-1.287-.005-.095-2.029-.9-2.817-1.677-.422-.416-.622-.616-.8-.767a3.47 3.47 0 00-.301-.227 5.388 5.388 0 01-.032-2.842c-1.195.544-2.124 1.403-2.8 2.163h-.006c-.46-.584-.428-2.51-.402-2.913-.006-.025-.343.176-.389.206-.406.29-.787.616-1.136.974-.397.403-.76.839-1.085 1.303a9.816 9.816 0 00-1.562 3.52c-.003.013-.11.487-.19 1.073-.013.09-.026.181-.037.272a7.8 7.8 0 00-.069.667l-.002.034-.023.387-.001.06C.386 18.795 5.593 24 12.016 24c5.752 0 10.527-4.176 11.463-9.661.02-.149.035-.298.052-.448.232-1.994-.025-4.09-.753-5.844z" />
    </svg>
  );
}

function AndroidMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path d="m7 5-1.4-2M17 5l1.4-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M5 10a7 7 0 0 1 14 0v1H5v-1Z" fill="currentColor" />
      <rect x="5" y="12" width="14" height="7" rx="1.5" fill="currentColor" />
      <path d="M3.5 12.5v4M20.5 12.5v4M8 18.5V22M16 18.5V22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="9" cy="8" r=".85" fill="var(--background)" />
      <circle cx="15" cy="8" r=".85" fill="var(--background)" />
    </svg>
  );
}

function WindowsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M2 4.1 10.6 3v8.2H2V4.1Zm9.8-1.3L22 1.5v9.7H11.8V2.8ZM2 12.5h8.6v8.3L2 19.6v-7.1Zm9.8 0H22v9.9l-10.2-1.4v-8.5Z" />
    </svg>
  );
}

function LinuxMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path d="M12 2.5c-2.5 0-3.7 2.5-3.6 5.5-1.8 1.8-3 4.4-3 7.1 0 3.5 2.8 5.9 6.6 5.9s6.6-2.4 6.6-5.9c0-2.7-1.2-5.3-3-7.1.1-3-1.1-5.5-3.6-5.5Z" fill="currentColor" />
      <path d="M9 13.2c.7-1.2 1.7-1.8 3-1.8s2.3.6 3 1.8c.8 1.4.6 3.5-.3 4.6-.7.9-1.6 1.3-2.7 1.3s-2-.4-2.7-1.3c-.9-1.1-1.1-3.2-.3-4.6Z" fill="var(--background)" />
      <circle cx="10.2" cy="7.3" r=".75" fill="var(--background)" />
      <circle cx="13.8" cy="7.3" r=".75" fill="var(--background)" />
      <path d="m10.4 9.2 1.6 1 1.6-1-1.6-.7-1.6.7Z" fill="var(--background)" />
      <path d="M7.2 20.2 4.5 22M16.8 20.2l2.7 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const ICONS: Record<IconKey, React.ElementType> = {
  chrome: Chrome,
  firefox: FirefoxMark,
  safari: Compass,
  macos: AppleMark,
  ios: AppleMark,
  android: AndroidMark,
  windows: WindowsMark,
  linux: LinuxMark,
  web: Globe,
};

/** Recognizable platform marks; configuration stays icon-library-free. */
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
