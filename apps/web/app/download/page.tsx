import type { Metadata } from "next";
import { marketingFontVars } from "@/components/marketing/fonts";
import { Backdrop } from "@/components/marketing/backdrop";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { Eyebrow, display, glass, mono } from "@/components/marketing/primitives";
import { ReleasesProvider } from "@/components/marketing/releases-provider";
import { PlatformCard } from "@/components/marketing/download/platform-card";
import { BuildFromSource } from "@/components/marketing/download/build-from-source";
import { PLATFORMS } from "@/lib/platforms";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Download Bookmark AI — Mac, Android, browser extensions, web",
  description:
    "Get Bookmark AI on every screen: download the Mac app and the Android APK, sideload the Chrome and Firefox extensions while the store listings are under review, add the web app to your phone, or build Safari and iOS from source.",
  alternates: { canonical: "https://www.bookmark-ai.cloud/download" },
  openGraph: {
    title: "Download Bookmark AI",
    description:
      "Mac app and Android APK today. Chrome and Firefox listings under review; Safari and iOS coming soon — or build them from source.",
    type: "website",
    siteName: "Bookmark AI",
    url: "https://www.bookmark-ai.cloud/download",
  },
};

/**
 * Public download page — the marketing shell (same nav, footer, backdrop and
 * fonts as the homepage), every platform from lib/platforms.ts with its real
 * status and inline install steps, then the build-from-source recipes.
 * Static; the only client bits are the release-record fetch behind the
 * Download buttons and the copy buttons on the command blocks.
 */
export default function DownloadPage() {
  const status = {
    review: PLATFORMS.filter((p) => p.status === "review").map((p) => p.name),
    soon: PLATFORMS.filter((p) => p.status === "soon").map((p) => p.name),
  };

  return (
    <div className={marketingFontVars}>
      <style
        dangerouslySetInnerHTML={{
          __html:
            "@media (prefers-reduced-motion: no-preference){html{scroll-behavior:smooth}}",
        }}
      />
      <Backdrop />
      <div className="relative z-10">
        <Nav />
        <main className="mx-auto w-full max-w-6xl px-6 pb-24 pt-14 sm:pt-20">
          <header className="max-w-2xl">
            <Eyebrow>downloads</Eyebrow>
            <h1
              className={cn(
                display,
                "mt-5 text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.025em] sm:text-5xl md:text-[3.5rem]",
              )}
            >
              Get Bookmark AI on every screen.
            </h1>
            <p className="mt-5 max-w-xl text-muted-foreground sm:text-lg">
              The Mac app and the Android APK download directly. The browser-store
              listings are under review, and Safari and iOS are coming soon — build them
              from source, or use the web app on any device in the meantime.
            </p>
          </header>

          <ReleasesProvider>
            <div
              className={cn(
                glass,
                "mt-10 flex flex-col gap-3 rounded-2xl px-5 py-4 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8",
              )}
            >
              <p>
                <span className={cn(mono, "mr-2 text-[11px] uppercase tracking-[0.18em] text-foreground")}>
                  under review
                </span>
                {status.review.join(" · ")} — available shortly.
              </p>
              <p>
                <span className={cn(mono, "mr-2 text-[11px] uppercase tracking-[0.18em] text-foreground")}>
                  coming soon
                </span>
                {status.soon.join(" · ")} — build from source or wait.
              </p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {PLATFORMS.map((p) => (
                <PlatformCard key={p.id} entry={p} wide={p.kind === "web"} />
              ))}
            </div>
          </ReleasesProvider>

          <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-muted-foreground">
            Store versions will replace the direct downloads once they are approved. The
            Mac and Android apps check for new builds when they launch and show an update
            banner with a download link, so you never have to come back here to find out.
          </p>

          <div className="mt-24">
            <BuildFromSource />
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
