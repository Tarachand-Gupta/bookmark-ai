import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Bookmark AI",
  description: "What Bookmark AI collects, how it's used, and the control you have over it.",
};

const UPDATED = "September 7, 2026";
const CONTACT_EMAIL = "tara@purecode.ai";

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
          It covers the hosted service at bookmark-ai.cloud and every way you use
          it: the web app, the browser extension, and the iOS, Android and macOS
          apps.
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
              <span className="font-medium text-foreground">Device context</span> — the browser or
              device a bookmark was saved from (for example &ldquo;Chrome&rdquo;,
              &ldquo;iPhone&rdquo;, &ldquo;Android&rdquo;) and its operating system, so
              your library can show where something came from. No advertising
              identifiers, no location.
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
            <li>
              <span className="font-medium text-foreground">What you ask the AI</span> — questions
              you type into Ask AI, and any photos or files you attach to them, are
              sent to our server and to the AI provider to produce the answer, and
              are stored with the conversation so you can come back to it. Delete a
              conversation to remove it.
            </li>
            <li>
              <span className="font-medium text-foreground">Live tabs (optional, off by default)</span> —
              if you turn on Live in the browser extension, it periodically sends
              the titles and URLs of your currently open tabs so you can see and
              reopen them from your other devices. Credential-looking URLs (sign-in
              links, tokens) are stripped before anything leaves your browser. Live
              data expires on its own seven days after a device last checked in,
              and turning Live off purges it immediately.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Apps and the browser extension</h2>
          <p>
            The web app, the browser extension and the mobile apps all talk to the
            same service, and this policy applies to all of them. The extension has
            no sign-in of its own — it mirrors the session you already have on
            bookmark-ai.cloud. The mobile apps keep your sign-in in the device&rsquo;s
            secure storage; photos and files you attach go through the system
            picker, so the apps never get blanket access to your library or files.
            None of our apps include advertising, analytics or tracking SDKs.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">How AI is used</h2>
          <p>
            Saved bookmarks are automatically categorized and embedded for search
            using Google&rsquo;s Gemini models. If you add your own AI provider key
            in Settings, that provider is used to power the chat assistant instead;
            keys you store are encrypted before they are saved. Your bookmarks are
            only sent to these services to provide these features — never for
            advertising.
          </p>
          <p>
            To debug and improve the assistant, AI requests and responses are
            traced to Langfuse, an observability service: what you send to the
            assistant (your questions and any attachments), what it answers, and
            the bookmark text it categorizes and embeds. Obvious secrets such as API
            keys are masked before a trace is sent. Tracing is controlled per
            feature by the service administrator and can be switched off.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Where your data lives</h2>
          <p>
            Your bookmarks, sessions and AI conversations are stored in your own
            isolated database, hosted on Turso. Your data is kept separate from other
            users&rsquo; data. The web app and API run on Vercel, and the live-tabs
            relay runs on a server we operate on Oracle Cloud. Everything is
            encrypted in transit (TLS) and at rest by these providers&rsquo; storage
            layers.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Retention</h2>
          <p>
            We keep your data until you delete it or your account. Deleting a
            bookmark, session or conversation removes it from your database
            immediately; deleting your account removes the database itself.
            Provider backups and server logs age out within 30 days, and live tabs
            expire after seven days as described above.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Your control</h2>
          <p>
            You can export a complete copy of everything you&rsquo;ve saved at any
            time from Settings → Data in the web app — a JSON file you can keep or
            import into another Bookmark AI instance. You can also permanently
            delete your account and all associated data from Settings → Account, on
            any platform; the steps are below.
          </p>
        </section>

        <section
          id="delete-account"
          className="scroll-mt-24 space-y-3 rounded-lg border border-border p-5"
        >
          <h2 className="text-lg font-semibold text-foreground">Delete your Bookmark AI account</h2>
          <p>
            To permanently delete your Bookmark AI account and all of its data
            (bookmarks, sessions, AI conversations, live tabs and your sign-in):
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-medium text-foreground">In the iOS or Android app</span>: open
              Settings → Account → Delete Account, then type DELETE to confirm.
            </li>
            <li>
              <span className="font-medium text-foreground">On the web</span>: sign in at
              bookmark-ai.cloud → Settings → Account → Delete account, then confirm.
            </li>
            <li>
              <span className="font-medium text-foreground">By email</span>: write to{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=Delete%20my%20Bookmark%20AI%20account`}
                className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-foreground/80"
              >
                {CONTACT_EMAIL}
              </a>{" "}
              from the address on your account and we will delete it within 30 days.
            </li>
          </ul>
          <p>
            Deletion is immediate and irreversible: your account, your database and
            everything in it are removed. Uninstalling the app or removing the
            extension alone does not delete your account.
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
              your bookmarks, sessions and conversations.
            </li>
            <li>
              <span className="font-medium text-foreground">Google Gemini</span> — AI
              categorization, embeddings, and (unless you configure your own
              provider) the chat assistant.
            </li>
            <li>
              <span className="font-medium text-foreground">Langfuse</span> — records the AI
              requests and responses (including your questions and the AI&rsquo;s
              answers) so we can debug and improve the assistant. Hosted in the
              United States.
            </li>
            <li>
              <span className="font-medium text-foreground">Vercel</span> — hosts the web app and
              API.
            </li>
            <li>
              <span className="font-medium text-foreground">Oracle Cloud</span> — hosts the
              live-tabs relay, which only holds data if you turn Live on.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Contact</h2>
          <p>
            Questions about this policy or your data: email{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-foreground/80"
            >
              {CONTACT_EMAIL}
            </a>
            . Help with the app itself is on the{" "}
            <Link
              href="/support"
              className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-foreground/80"
            >
              support page
            </Link>
            .
          </p>
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
