import type { AuthSession } from "../api";

const PLATFORMS: Record<string, { label: string; symbol: "iphone" | "desktopcomputer" | "globe" | "safari"; group: "apps" | "extensions" }> = {
  ios: { label: "iOS app", symbol: "iphone", group: "apps" },
  android: { label: "Android app", symbol: "iphone", group: "apps" },
  macos: { label: "Mac app", symbol: "desktopcomputer", group: "apps" },
  web: { label: "Website", symbol: "globe", group: "apps" },
  pwa: { label: "Web app", symbol: "globe", group: "apps" },
  "chrome-extension": { label: "Chrome extension", symbol: "globe", group: "extensions" },
  "firefox-extension": { label: "Firefox extension", symbol: "globe", group: "extensions" },
  "safari-extension": { label: "Safari extension", symbol: "safari", group: "extensions" },
};

export function presentSession(session: AuthSession) {
  const platform = PLATFORMS[session.clientType ?? ""] ?? { label: "App or website", symbol: "globe" as const, group: "apps" as const };
  const raw = session.displayName.trim();
  const generic = !raw || /^(unknown device|(?:web|pwa|ios|android|macos|.*-extension) device)$/i.test(raw) || /^(sdk_|.*gphone|emulator_)/i.test(raw);
  const browser = session.browser?.trim();
  const title = generic ? platform.label : raw;
  const os = session.os?.replace(/^android\s+/i, "Android ").replace(/^ios\s+/i, "iOS ").replace(/^macos$/i, "macOS");
  const metadata = [platform.label, browser && !platform.label.toLowerCase().includes(browser.toLowerCase()) ? browser : null, os].filter(Boolean).join(" · ");
  return { ...platform, title, metadata };
}

/** Display grouping never changes IDs or combines distinct SDK sessions. */
export function groupSessions(sessions: AuthSession[]) {
  const ordered = sessions.map((session, index) => ({ session, index })).sort((a, b) =>
    Number(b.session.isCurrent) - Number(a.session.isCurrent) ||
    (Date.parse(b.session.lastActiveAt ?? b.session.createdAt) || 0) - (Date.parse(a.session.lastActiveAt ?? a.session.createdAt) || 0) || a.index - b.index,
  ).map(({ session }) => session);
  return {
    apps: ordered.filter(session => presentSession(session).group === "apps"),
    extensions: ordered.filter(session => presentSession(session).group === "extensions"),
  };
}
