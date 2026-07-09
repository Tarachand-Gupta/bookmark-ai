import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@bookmark-ai/ui", "@bookmark-ai/types"],
  images: {
    // OG images come from arbitrary bookmarked sites.
    remotePatterns: [{ protocol: "https", hostname: "**" }, { protocol: "http", hostname: "**" }],
  },
};

export default nextConfig;
