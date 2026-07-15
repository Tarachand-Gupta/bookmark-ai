import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Bookmark AI",
  description: "The plain-language terms for using Bookmark AI.",
};

const UPDATED = "July 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-6 py-16">
      <Link
        href="/"
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to home
      </Link>

      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated {UPDATED}</p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-muted-foreground">
        <p className="text-foreground">
          These terms cover your use of the hosted Bookmark AI service. They&rsquo;re
          written to be readable, not to bury anything in legalese. By using the
          service, you agree to what&rsquo;s below.
        </p>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Provided as-is</h2>
          <p>
            Bookmark AI is provided on an &ldquo;as-is&rdquo; and
            &ldquo;as-available&rdquo; basis, without warranties of any kind. We do
            our best to keep it working and your data safe, but we can&rsquo;t
            guarantee the service will always be available, error-free, or fit for a
            particular purpose. Keep your own backups of anything important — the
            export feature exists for exactly this.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Your data is yours</h2>
          <p>
            You own the bookmarks and sessions you save. You can export a complete
            copy at any time, and you can permanently delete your account and all of
            your data from Settings. We claim no ownership over your content.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Acceptable use</h2>
          <p>Please don&rsquo;t use Bookmark AI to:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>store or distribute illegal content, or anything you don&rsquo;t have the right to;</li>
            <li>abuse, overload, or attempt to disrupt the service or its infrastructure;</li>
            <li>attempt to access other users&rsquo; data or break the app&rsquo;s isolation.</li>
          </ul>
          <p>
            We may suspend or remove accounts that abuse the service or put other
            users at risk.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Open source &amp; self-hosting</h2>
          <p>
            Bookmark AI is open-source software. You&rsquo;re free to run your own
            instance under the terms of its license. These terms apply to the hosted
            service we operate; a deployment you run yourself is your own
            responsibility.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Changes</h2>
          <p>
            The service will evolve — features may be added, changed, or removed over
            time, and these terms may be updated to match. Continued use after a
            change means you accept the updated terms.
          </p>
        </section>
      </div>
    </main>
  );
}
