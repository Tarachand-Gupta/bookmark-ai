/** One staged Metro can serve both simulators; phones use an explicit LAN URL. */
export function nativeEndpoint(value: string, platform: string): string {
  const url = new URL(value);
  if (platform === "android" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) url.hostname = "10.0.2.2";
  return url.toString().replace(/\/$/, "");
}
