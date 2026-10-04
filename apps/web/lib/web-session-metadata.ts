import { detectSource } from "./detect";

/** Best-effort display metadata only; never establishes session identity or scope. */
export function webSessionMetadata(standalone: boolean) {
  const { browser, os } = detectSource();
  const browserName = { chrome: "Chrome", safari: "Safari", firefox: "Firefox", edge: "Edge", arc: "Arc", other: "Browser" }[browser];
  return {
    clientType: standalone ? "pwa" as const : "web" as const,
    deviceName: `${standalone ? "PWA" : "Web"} · ${browserName}`,
    ...(browser !== "other" ? { browser: browserName } : {}),
    ...(os !== "unknown" ? { os } : {}),
  };
}
