import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";

/**
 * Marketing-only typefaces. These expose CSS variables (`--font-display`,
 * `--font-mono-marketing`) via their `.variable` classNames, which are applied
 * ONLY on the landing page's root wrapper — so the product UI under /app keeps
 * its own (system) typography untouched.
 *
 * Bricolage Grotesque is the characterful display voice (used with restraint,
 * only for headlines). JetBrains Mono carries the identity: bookmarks are URLs,
 * so mono grounds every eyebrow, label, domain, and metadata line in the
 * subject's own material.
 */
export const displayFont = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800"],
});

export const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono-marketing",
  weight: ["400", "500", "600", "700"],
});

/** Applied to the marketing root so the scoped font variables resolve. */
export const marketingFontVars = `${displayFont.variable} ${monoFont.variable}`;
