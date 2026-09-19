import type { Metadata } from "next";
import { marketingFontVars } from "@/components/marketing/fonts";
import { Backdrop } from "@/components/marketing/backdrop";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { Eyebrow, display } from "@/components/marketing/primitives";
import { ReleasesProvider } from "@/components/marketing/releases-provider";
import { DownloadColumns } from "@/components/marketing/download/download-columns";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Download Bookmark AI — Apps and browser extensions",
  description:
    "Get Bookmark AI on every screen. Use the installable web app or add the browser extension from your marketplace.",
  alternates: { canonical: "https://www.bookmark-ai.cloud/download" },
  openGraph: {
    title: "Download Bookmark AI",
    description:
      "Use Bookmark AI as an installable web app or add the browser extension from your marketplace.",
    type: "website",
    siteName: "Bookmark AI",
    url: "https://www.bookmark-ai.cloud/download",
  },
};

/**
 * Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Public download page — the existing marketing shell with two compact,
 * factual availability columns. Detailed PWA guidance stays folded until it
 * is useful; platform status continues to come from lib/platforms.ts.
 */
export default function DownloadPage() {
  return (
    <div className={cn(marketingFontVars, "overflow-x-clip")}>
      <style
        dangerouslySetInnerHTML={{
          __html:
            "@media (prefers-reduced-motion: no-preference){html{scroll-behavior:smooth}}",
        }}
      />
      <Backdrop />
      <div className="relative z-10">
        <Nav />
        <main className="mx-auto w-full max-w-6xl px-5 pb-24 pt-12 sm:px-6 sm:pt-16">
          <header className="max-w-3xl">
            <Eyebrow>downloads</Eyebrow>
            <h1
              className={cn(
                display,
                "mt-5 min-w-0 [overflow-wrap:anywhere] text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.025em] sm:text-5xl md:text-[3.5rem]",
              )}
            >
              Bookmark AI, where you need it.
            </h1>
            <p className="mt-5 max-w-2xl text-muted-foreground sm:text-lg">
              Choose an app or add the extension to your browser. Every option connects
              to the same account, library and live tabs.
            </p>
          </header>

          <ReleasesProvider>
            <div className="mt-10 sm:mt-12">
              <DownloadColumns />
            </div>
          </ReleasesProvider>
        </main>
        <Footer />
      </div>
    </div>
  );
}
