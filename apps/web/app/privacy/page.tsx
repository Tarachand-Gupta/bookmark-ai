import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Bookmark AI",
  description: "What Bookmark AI collects, how it's used, and the control you have over it.",
};

const UPDATED = "July 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-6 py-16">
      <Link
        href="/"
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to home
      </Link>

      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated {UPDATED}</p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-muted-foreground">
        <p className="text-foreground">
          Bookmark AI is a tool for saving and searching your own bookmarks. This
          page explains, in plain language, what we store and why. If anything here
          is unclear, the code is open source — you can read exactly how it works.
        </p>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">What we collect</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-medium text-foreground">The bookmarks and sessions you save</span> —
              the URLs, titles, and saved tab groups you send to the app, along with
              basic context like which browser or device they came from.
            </li>
            <li>
              <span className="font-medium text-foreground">Your account details</span> — your email
              address and name, provided through sign-in and handled by our
              authentication provider (Clerk).
            </li>
            <li>
              <span className="font-medium text-foreground">Page metadata</span> — when you save a
              URL, the app fetches that page&rsquo;s public Open Graph data (title,
              description, preview image) so your library is readable at a glance.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">How AI is used</h2>
          <p>
            Saved bookmarks are automatically categorized and embedded for search
            using Google&rsquo;s Gemini models. If you add your own AI provider key
            in Settings, that provider is used to power the chat assistant instead.
            Your bookmarks are only sent to these services to provide these
            features — never for advertising.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Where your data lives</h2>
          <p>
            Your bookmarks and sessions are stored in your own isolated database,
            hosted on Turso. Your data is kept separate from other users&rsquo; data.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Your control</h2>
          <p>
            You can export a complete copy of everything you&rsquo;ve saved at any
            time from Settings → Data. You can also permanently delete your account
            and all associated bookmarks and sessions from Settings → Account. This
            deletion is irreversible.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">We don&rsquo;t sell your data</h2>
          <p>
            We do not sell your data or share it with advertisers. Data is shared
            only with the third-party services required to run the app:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-medium text-foreground">Clerk</span> — sign-in and account
              management.
            </li>
            <li>
              <span className="font-medium text-foreground">Turso</span> — the database that stores
              your bookmarks and sessions.
            </li>
            <li>
              <span className="font-medium text-foreground">Google Gemini</span> — AI
              categorization, embeddings, and (unless you configure your own
              provider) the chat assistant.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Self-hosting</h2>
          <p>
            Bookmark AI is open-source software. If you&rsquo;d rather keep
            everything on infrastructure you control, you can run your own instance;
            in that case this hosted policy doesn&rsquo;t apply to your deployment.
          </p>
        </section>
      </div>
    </main>
  );
}
