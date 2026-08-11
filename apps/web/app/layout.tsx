import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import { ThemeColorMeta } from "@/components/theme-color-meta";
import { THEME_COLOR } from "@/lib/theme-colors";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bookmark AI",
  description: "Save bookmarks from any browser — organized automatically by AI.",
  // Home-screen install on iOS. `statusBarStyle: "black-translucent"` is the fix
  // for the white band that used to sit above a dark app, and it was chosen from
  // measurements on iOS 26, not from the docs:
  //
  // - "default" gives the status bar its OWN opaque band. iOS colors that band
  //   once, from `theme-color` as resolved when the app was added to the Home
  //   Screen, and then never revisits it: an app installed while the system was
  //   light kept a #ffffff band forever — through a theme toggle, a relaunch, and
  //   even a system-appearance flip. No amount of correct `theme-color` fixes an
  //   already-installed app, which is exactly the bug that was reported.
  // - "black-translucent" makes the status bar sit on top of the web view, so the
  //   band is painted by the PAGE (in `--background`, by the standalone rules in
  //   globals.css) and therefore CANNOT disagree with it — in any combination of
  //   system theme and manual override, and with no JS involved. iOS inverts the clock
  //   and battery glyphs to suit it (verified: black glyphs on #ffffff, white on
  //   #0a0a0a), so the old "always-white glyphs" objection no longer applies.
  //
  // `viewportFit: "cover"` below is required, not optional: black-translucent
  // alone leaves that strip outside the layout viewport, where it shows the
  // WINDOW background (the manifest's single static background_color) and so goes
  // stale the moment the theme changes. With cover the page owns the strip and
  // globals.css paints it in `--background` — see the standalone block there,
  // which also keeps content clear of the clock.
  appleWebApp: {
    capable: true,
    title: "Bookmark AI",
    statusBarStyle: "black-translucent",
  },
  // Next renders `appleWebApp.capable` as the modern <meta
  // name="mobile-web-app-capable">. iOS only learned to take standalone from the
  // manifest's `display` field in 17.4; before that the apple-prefixed meta is
  // the ONLY switch, and without it the icon opens in Safari with full browser
  // chrome (no status-bar band to color at all). Cheap to keep both.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the page draw into the status-bar strip on an iOS home-screen install
  // (see appleWebApp above + the standalone block in globals.css). No effect in a
  // browser tab, where the safe-area insets are 0.
  viewportFit: "cover",
  // Android browser/app chrome and iOS Safari's toolbar tint. Two media variants
  // get the "system" theme right on first paint, before any JS; the manual
  // light/dark override is handled by <ThemeColorMeta /> below. (The iOS
  // home-screen status bar no longer depends on this — see appleWebApp above.)
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {/* Class-based dark mode; Clerk's shadcn theme reads the same CSS
            variables, so its components follow the toggle automatically. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* Mirrors the resolved theme into <meta name="theme-color"> so browser
              chrome (Android Chrome's toolbar, an installed Android PWA, iOS
              Safari's tint) follows a MANUAL light/dark override, which a
              prefers-color-scheme media query cannot see. */}
          <ThemeColorMeta />
          {/* shadcn theme keeps Clerk's UserButton + sign-in modal on-brand. */}
          <ClerkProvider appearance={{ theme: shadcn }}>{children}</ClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
