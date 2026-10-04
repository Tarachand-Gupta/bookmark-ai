/** One staged Metro can serve both simulators; phones use an explicit LAN URL. */
export function nativeEndpoint(value: string, platform: string): string {
  const url = new URL(value);
  if (platform === "android" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) url.hostname = "10.0.2.2";
  return url.toString().replace(/\/$/, "");
}

/** Explicit hosted builds never infer production from a missing/default target. */
export function assertAuthEndpoints(marker:string|undefined,api:string,live:string) {
  if(marker && marker!=="production")throw new Error("Unknown hosted authentication target");
  if(marker==="production") {
    if(api!=="https://www.bookmark-ai.cloud"||live!=="https://live.bookmark-ai.cloud")throw new Error("Hosted authentication requires exact approved endpoints");
    return;
  }
  for(const value of [api,live]) {
    const url=new URL(value);
    if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.search||url.hash||/bookmark-ai\.cloud$|vercel\.app$/.test(url.hostname))throw new Error("QA authentication cannot fall back to production");
  }
}
