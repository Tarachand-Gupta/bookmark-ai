import { PlatformIcon } from "@/components/marketing/platform-icon";

/** Provider marks use the same restrained monochrome treatment as our platform icons. */
export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3.02h3.88c2.27-2.09 3.54-5.18 3.54-8.89ZM12 24c3.24 0 5.95-1.08 7.94-2.91l-3.88-3.02c-1.08.72-2.45 1.16-4.06 1.16-3.13 0-5.79-2.11-6.74-4.96H1.26v3.11A12 12 0 0 0 12 24ZM5.26 14.27a7.2 7.2 0 0 1 0-4.54V6.62H1.26a12 12 0 0 0 0 10.76l4-3.11ZM12 4.77c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.51 11.51 0 0 0 12 0 12 12 0 0 0 1.26 6.62l4 3.11C6.21 6.88 8.87 4.77 12 4.77Z" />
    </svg>
  );
}

export function AppleIcon({ className }: { className?: string }) {
  return <PlatformIcon icon="macos" className={className} />;
}
