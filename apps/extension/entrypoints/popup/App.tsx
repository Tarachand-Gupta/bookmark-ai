import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { Bookmark, Session } from "@bookmark-ai/types";
import { DEFAULT_WEB_URL, getWebBaseUrl } from "@/lib/api";
import { PerfTrace } from "@/lib/perf";
import { requestSaveBookmark, requestSaveSession } from "@/lib/messages";
import { openApp, openDeviceSettings } from "./nav";
import { SIGNED_OUT, useAuth } from "./use-auth";
import { useLive } from "./use-live";
import { BentoGrid } from "./components/BentoGrid";
import { CompactStrip } from "./components/CompactStrip";
import { ConfirmationCard } from "./components/ConfirmationCard";
import { DeviceFooter } from "./components/DeviceFooter";
import { ErrorNote } from "./components/ErrorNote";
import { Header } from "./components/Header";
import { HeroSaveCard, type TabInfo } from "./components/HeroSaveCard";
import { LivePanel } from "./components/LivePanel";
import { PopupShell } from "./components/PopupShell";
import { SignInGate } from "./components/SignInGate";
import { Spinner } from "./components/Spinner";
import { Button } from "./components/ui/button";
import { ExternalLinkIcon } from "./components/ui/icons";

/** A confirmation the user never touches dismisses itself, as it always has. */
const AUTO_CLOSE_MS = 1200;
/** A session save that takes longer than this says so, instead of leaving the user
 * staring at a spinner wondering whether the click registered. Long enough that a
 * normal save (well under a second) never shows it. */
const SLOW_SAVE_MS = 1500;

const DEGRADED_NOTE =
  "Couldn't reach the extension background. Sign in on the website — your session still syncs back here.";

type Status =
  | "idle"
  | "saving"
  | "saved"
  | "savingSession"
  | "savingSessionKeepOpen"
  | "sessionSaved"
  | "error";

/**
 * The popup, in three screens: the default save surface, the live panel expanded
 * over it, and the post-save confirmation.
 *
 * App owns only the save state machine and the active tab; auth lives in
 * `useAuth`, live tabs in `useLive`, and every pixel is rendered by a component
 * under `./components` (which in turn draw on the `./components/ui` primitives —
 * no component here composes its own button chrome).
 */
export default function App() {
  const { auth, degraded, setAuth } = useAuth();
  const live = useLive();

  const [tab, setTab] = useState<TabInfo | null>(null);
  const [tabCount, setTabCount] = useState<number | null>(null);
  // Pre-resolved at mount so the save click doesn't pay a `windows.getCurrent()`
  // round trip before it can even send the message.
  const [windowId, setWindowId] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [bookmark, setBookmark] = useState<Bookmark | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webUrl, setWebUrl] = useState<string>(DEFAULT_WEB_URL);
  // A session save still running after SLOW_SAVE_MS — swaps the silent spinner for
  // a "still working, your tabs are safe" line.
  const [slowSave, setSlowSave] = useState(false);
  // The confirmation auto-dismisses (unchanged), UNLESS the user reaches for one
  // of its follow-ups — yanking the popup out from under a click would be worse
  // than leaving it open.
  const [holdOpen, setHoldOpen] = useState(false);

  useEffect(() => {
    void browser.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
      if (active?.url) {
        setTab({ url: active.url, title: active.title, favIconUrl: active.favIconUrl });
      }
    });
    // Count restorable tabs in THIS window for the session tile labels —
    // sessions are per-window, other windows are left alone.
    void browser.tabs
      .query({ currentWindow: true })
      .then((tabs) => setTabCount(tabs.filter((t) => t.url && /^https?:/i.test(t.url)).length));
    void browser.windows.getCurrent().then((win) => {
      if (typeof win.id === "number") setWindowId(win.id);
    });
    void getWebBaseUrl().then(setWebUrl);
  }, []);

  useEffect(() => {
    if (status !== "saved" && status !== "sessionSaved") return;
    if (holdOpen) return;
    const timer = setTimeout(() => window.close(), AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [status, holdOpen]);

  async function handleSaveBookmark() {
    if (!tab || status === "saving") return;
    setStatus("saving");
    setError(null);
    const result = await requestSaveBookmark(tab.url, tab.title);
    if (result.ok) {
      setBookmark(result.bookmark);
      setStatus("saved");
    } else {
      setError(result.error);
      setStatus("error");
    }
  }

  async function handleSaveSession(keepOpen: boolean) {
    if (status === "savingSession" || status === "savingSessionKeepOpen") return;
    // Feedback FIRST: the spinner state is set before any await, so the click is
    // acknowledged in the same frame no matter how slow the round trip is.
    setStatus(keepOpen ? "savingSessionKeepOpen" : "savingSession");
    setError(null);
    const perf = new PerfTrace("session save (popup)");
    // A save that outlives the tile spinner gets a line of reassurance —
    // especially on the closing path, where the honest thing to say is that the
    // tabs are still safe (nothing closes until the server confirms the save).
    const slowTimer = window.setTimeout(() => setSlowSave(true), SLOW_SAVE_MS);
    // Scope the session to the popup's window; the background can't resolve
    // "current window" reliably from its own context. Pre-resolved at mount, so
    // the click path normally skips this hop entirely.
    const id = windowId ?? (await browser.windows.getCurrent()).id;
    perf.mark("windowId");
    const result = await requestSaveSession({ windowId: id, keepOpen });
    perf.mark("roundTrip");
    perf.end({ ok: result.ok, keepOpen, prewarmedWindowId: windowId !== null });
    window.clearTimeout(slowTimer);
    setSlowSave(false);
    if (result.ok) {
      if (keepOpen) {
        // The window survives, so this popup does too — confirm the save, then
        // auto-close on the same rhythm as a bookmark save.
        setSession(result.session);
        setStatus("sessionSaved");
      } else {
        // The background script now closes this window and opens the web app;
        // the popup disappears with its window.
        window.close();
      }
    } else {
      setError(result.error);
      setStatus("error");
    }
  }

  /** "Done": back to the default screen rather than closing, so a save the user
   * engaged with is never a dead end. */
  function dismissConfirmation() {
    setBookmark(null);
    setSession(null);
    setHoldOpen(false);
    setStatus("idle");
  }

  // Auth still resolving — the header alone, so we neither flash the save UI nor
  // the sign-in gate before we know which one to show.
  if (!auth) {
    return (
      <PopupShell>
        <Header />
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Spinner />
        </div>
      </PopupShell>
    );
  }

  // Signed out: the gate is the ONLY thing the popup shows. `stale` (Safari,
  // no app tab open) renders the reconnect variant with the last-known name.
  if (!auth.signedIn) {
    return (
      <SignInGate
        webUrl={webUrl}
        note={degraded ? DEGRADED_NOTE : undefined}
        reconnectAs={auth.stale ? (auth.name ?? auth.email ?? "") : undefined}
      />
    );
  }

  const savable = tab !== null && /^https?:/i.test(tab.url);
  const busy =
    status === "saving" || status === "savingSession" || status === "savingSessionKeepOpen";
  const tabLabel = `${tabCount ?? 0} tab${tabCount === 1 ? "" : "s"}`;
  const confirming =
    (status === "saved" && bookmark !== null) || (status === "sessionSaved" && session !== null);

  return (
    <PopupShell>
      <Header user={auth} webUrl={webUrl} onSignedOut={() => setAuth(SIGNED_OUT)} />

      {confirming ? (
        // Reaching for either follow-up cancels the auto-close.
        <div
          className="flex flex-col gap-3"
          onMouseEnter={() => setHoldOpen(true)}
          onFocusCapture={() => setHoldOpen(true)}
        >
          {status === "saved" && bookmark ? (
            <ConfirmationCard variant="bookmark" bookmark={bookmark} />
          ) : (
            <ConfirmationCard variant="session" session={session!} />
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => openApp(webUrl)}>
              <ExternalLinkIcon className="size-3.5" strokeWidth={1.8} />
              View in app
            </Button>
            <Button variant="ghost" onClick={dismissConfirmation}>
              Done
            </Button>
          </div>
        </div>
      ) : live.expanded ? (
        <>
          <LivePanel live={live} webUrl={webUrl} />
          <CompactStrip
            saving={status === "saving"}
            savingSession={status === "savingSessionKeepOpen"}
            savable={savable}
            busy={busy}
            tabCount={tabCount}
            onSave={() => void handleSaveBookmark()}
            onSaveSession={() => void handleSaveSession(true)}
            onOpenApp={() => openApp(webUrl)}
            onOpenSettings={() => openDeviceSettings(webUrl)}
          />
        </>
      ) : (
        <>
          <HeroSaveCard
            tab={tab}
            saving={status === "saving"}
            savable={savable}
            busy={busy}
            onSave={() => void handleSaveBookmark()}
          />

          <BentoGrid
            tabCount={tabCount}
            savingSession={status === "savingSessionKeepOpen"}
            savingSessionClose={status === "savingSession"}
            busy={busy}
            webUrl={webUrl}
            live={live}
            onSaveSession={() => void handleSaveSession(true)}
            onSaveAndClose={() => void handleSaveSession(false)}
            onOpenApp={() => openApp(webUrl)}
          />

          <DeviceFooter deviceLabel={live.label} onOpenSettings={() => openDeviceSettings(webUrl)} />
        </>
      )}

      {/* Only after SLOW_SAVE_MS. On the closing path it doubles as the promise
          we actually keep: the window is closed AFTER the server confirms the
          save, never before. */}
      {slowSave && (
        <p className="text-[11px] leading-snug text-muted-foreground" role="status">
          {status === "savingSession"
            ? `Saving ${tabLabel}… your tabs stay open until the save is confirmed.`
            : `Saving ${tabLabel}… hang on.`}
        </p>
      )}

      {status === "error" && error && <ErrorNote message={error} />}
    </PopupShell>
  );
}
