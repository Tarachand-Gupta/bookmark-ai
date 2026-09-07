import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DOCS_URL, REPO } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Support — Bookmark AI",
  description: "How to get help with Bookmark AI, and answers to the most common questions.",
};

const CONTACT_EMAIL = "tara@purecode.ai";

const linkClass =
  "font-medium text-foreground underline underline-offset-4 transition-colors hover:text-foreground/80";

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Do I need an account?",
    a: (
      <>
        Yes. Everything in Bookmark AI is your own synced library, so every surface — the
        web app, the extension and the mobile apps — asks you to sign in first. Sign-in is
        handled by Clerk with email and password or Google.
      </>
    ),
  },
  {
    q: "How do I save a page?",
    a: (
      <>
        In a desktop browser, click the Bookmark AI extension button on any page (it can also
        save a whole window of tabs as a session). On iPhone, iPad or Android, use the share
        sheet → <span className="text-foreground">Save to Bookmark AI</span>. In the web app,
        click <span className="text-foreground">Add bookmark</span> and paste the URL.
      </>
    ),
  },
  {
    q: "The extension says I'm signed out — why?",
    a: (
      <>
        The browser extension has no sign-in of its own: it mirrors the session you have on
        bookmark-ai.cloud in the same browser. Open the website, sign in there, and the
        extension picks it up. Signing out of the website signs the extension out too.
      </>
    ),
  },
  {
    q: "How do I export my data?",
    a: (
      <>
        In the web app, open Settings → <span className="text-foreground">Data</span> and
        choose Export. You get a JSON file with every bookmark and session, which you can keep
        as a backup or import into another Bookmark AI instance from the same screen.
      </>
    ),
  },
  {
    q: "How do I delete my account?",
    a: (
      <>
        From Settings → Account on the web or in the mobile apps, or by email. The exact steps
        are in the{" "}
        <Link href="/privacy#delete-account" className={linkClass}>
          privacy policy
        </Link>
        . Deletion removes your account and everything in it, permanently.
      </>
    ),
  },
  {
    q: "Is it open source?",
    a: (
      <>
        Yes. The whole project — web app, API, extension and apps — is on{" "}
        <a href={REPO} target="_blank" rel="noreferrer noopener" className={linkClass}>
          GitHub
        </a>
        , and you can run your own instance if you prefer.
      </>
    ),
  },
];

export default function SupportPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-6 py-16">
      <Link
        href="/"
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to home
      </Link>

      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Support</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Help with Bookmark AI on the web, in the browser extension, and in the mobile apps.
      </p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-muted-foreground">
        <p className="text-foreground">
          Bookmark AI saves bookmarks from any browser or device into one searchable library.
          Each save is enriched with the page&rsquo;s metadata, categorized and embedded by AI,
          and you can browse it, search it in plain language, or ask the built-in assistant
          about what you&rsquo;ve saved — from the web app, the browser extension, or the
          macOS and Android apps (the iOS app is coming soon).
        </p>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Contact</h2>
          <p>
            Bookmark AI is made by Tarachand Gupta (PureCode). Email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>
              {CONTACT_EMAIL}
            </a>{" "}
            — replies usually arrive within two business days. Include which app you&rsquo;re
            using (web, extension, iOS, Android or macOS) and, on mobile, the version shown in
            Settings → About.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Installing</h2>
          <p>
            Every download and its install steps are on the{" "}
            <Link href="/download" className={linkClass}>
              download page
            </Link>
            . In short: the{" "}
            <Link href="/download#macos" className={linkClass}>
              Mac app
            </Link>{" "}
            and the{" "}
            <Link href="/download#android" className={linkClass}>
              Android APK
            </Link>{" "}
            download directly; the Chrome and Firefox extension listings are under review
            (sideload the zip meanwhile); the Safari extension and the iOS app are coming
            soon — build them from source, or add the{" "}
            <Link href="/download#web" className={linkClass}>
              web app
            </Link>{" "}
            to your home screen. The Mac and Android apps show an update banner when a
            new build is out.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Useful links</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <a href={DOCS_URL} target="_blank" rel="noreferrer noopener" className={linkClass}>
                Documentation
              </a>{" "}
              — setup guides for every platform and the API.
            </li>
            <li>
              <Link href="/privacy" className={linkClass}>
                Privacy Policy
              </Link>{" "}
              — what we store, where it lives, and how to delete it.
            </li>
            <li>
              <Link href="/terms" className={linkClass}>
                Terms of Service
              </Link>
            </li>
            <li>
              <a href={REPO} target="_blank" rel="noreferrer noopener" className={linkClass}>
                Source code on GitHub
              </a>{" "}
              — report bugs or request features as issues.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Common questions</h2>
          <dl className="space-y-5">
            {FAQ.map((item) => (
              <div key={item.q} className="space-y-1">
                <dt className="font-medium text-foreground">{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </main>
  );
}
