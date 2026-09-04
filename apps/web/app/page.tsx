import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { marketingFontVars } from "@/components/marketing/fonts";
import { Backdrop } from "@/components/marketing/backdrop";
import { Nav } from "@/components/marketing/nav";
import { Hero } from "@/components/marketing/hero";
import { Features } from "@/components/marketing/features";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Platforms } from "@/components/marketing/platforms";
import { Pricing } from "@/components/marketing/pricing";
import { OpenSource } from "@/components/marketing/open-source";
import { Footer } from "@/components/marketing/footer";

export const metadata: Metadata = {
  title: "Bookmark AI — your tabs and bookmarks, everywhere",
  description:
    "See your open tabs live on every device, and save pages from any browser. Bookmark AI auto-categorizes, tags, and embeds each one, so you can search your whole library by meaning. Free and open source.",
  openGraph: {
    title: "Bookmark AI — your tabs and bookmarks, everywhere",
    description:
      "Your open tabs, live on every device. Save from any browser, and find anything by meaning, not just keywords. Free and open source.",
    type: "website",
    siteName: "Bookmark AI",
    url: "https://bookmark-ai.cloud",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bookmark AI — your tabs and bookmarks, everywhere",
    description:
      "Your open tabs, live on every device. Save from any browser, find anything by meaning. Free and open source.",
  },
};

/**
 * Public marketing home. Signed-in users never see it — they're bounced to the
 * app, preserving any query string so the extension's `/?section=sessions`
 * bare-origin deep link still lands on the right view.
 *
 * Stays a fast server component; the only client islands are the chaos→order
 * hero field, the platform marquee, and the scroll reveals. Marketing fonts are
 * scoped here via CSS variables on the root wrapper, so /app is unaffected.
 */
export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await auth();
  if (userId) {
    const params = await searchParams;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) for (const v of value) qs.append(key, v);
      else if (value != null) qs.set(key, value);
    }
    const query = qs.toString();
    redirect(query ? `/app?${query}` : "/app");
  }

  return (
    <div className={marketingFontVars}>
      {/* Smooth in-page anchor scroll, but only when motion is welcome. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            "@media (prefers-reduced-motion: no-preference){html{scroll-behavior:smooth}}",
        }}
      />
      <Backdrop />
      <div className="relative z-10">
        <Nav />
        <main>
          <Hero />
          <Features />
          <HowItWorks />
          <Platforms />
          <Pricing />
          <OpenSource />
        </main>
        <Footer />
      </div>
    </div>
  );
}
