import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { Bookmark, Session } from "@bookmark-ai/types";
import { DEFAULT_WEB_URL, getWebBaseUrl } from "@/lib/api";
import { diag } from "@/lib/diag";
import { iconUrl } from "@/lib/icon";
import { PerfTrace } from "@/lib/perf";
import {
  requestSaveBookmark,
  requestSaveSession,
  requestUser,
  type UserInfo,
} from "@/lib/messages";
import { ErrorNote } from "./components/ErrorNote";
import { LiveTabsToggle } from "./components/LiveTabsToggle";
import { MaskedEmail } from "./components/MaskedEmail";
import { SaveCard, type TabInfo } from "./components/SaveCard";
import { SavedResult } from "./components/SavedResult";
import { SessionSavedResult } from "./components/SessionSavedResult";
import { SettingsButton } from "./components/SettingsButton";
import { SignInGate } from "./components/SignInGate";
import { SignOutButton } from "./components/SignOutButton";
import { Spinner } from "./components/Spinner";

const AUTO_CLOSE_MS = 1200;
/** Re-check auth while the signed-out gate is up, so signing in on the web tab
 * promotes the popup without a reopen (paired with the visibilitychange re-check
 * for when the popup regains focus). */
const AUTH_POLL_MS = 2000;
/** How long to wait for the background's first `GET_USER` answer before giving
 * up and showing the signed-out gate instead of the spinner. The background can
 * hang indefinitely (e.g. `@clerk/chrome-extension`'s client never settling
 * under Safari), which would otherwise leave `auth` null and the popup spinning
 * forever. This is correct on every browser: a boot that can't resolve auth in a
 * few seconds should still render a usable, actionable UI. */
const BOOT_TIMEOUT_MS = 5000;
/** A session save that takes longer than this says so, instead of leaving the user
 * staring at a spinner wondering whether the click registered. Long enough that a
 * normal save (well under a second) never shows it. */
const SLOW_SAVE_MS = 1500;

const DEGRADED_NOTE =
  "Couldn't reach the extension background. Sign in on the website — your session still syncs back here.";

const SIGNED_OUT: UserInfo = { signedIn: false, name: null, email: null };

/** Popup-side probe of the background page's liveness — the decisive signal for
 * "does Safari actually run the MV2 background script?". `getBackgroundPage` is
 * MV2-only (absent on MV3/Chrome) and may be disallowed on Safari, so it's fully
 * guarded. `hasBackgroundVar` checks the bundle's top-level `var background`,
 * i.e. whether background.js evaluated at all. Lands in the dev log on any popup
 * open — no browser console needed. */
async function probeBackground(): Promise<void> {
  try {
    const getBg = (
      browser.runtime as unknown as {
        getBackgroundPage?: () => Promise<(Window & { background?: unknown }) | null>;
      }
    ).getBackgroundPage;
    if (typeof getBg !== "function") {
      diag("popup", "bg probe", { getBackgroundPage: false });
      return;
    }
    const w = await getBg();
    diag("popup", "bg probe", {
      gotWindow: !!w,
      hasBackgroundVar: w ? "background" in w : null,
      readyState: w?.document?.readyState ?? null,
      scriptCount: w?.document?.scripts?.length ?? null,
    });
  } catch (e) {
    diag("popup", "bg probe", { err: e instanceof Error ? e.message : String(e) });
  }
}

/** Both session buttons are the same control with different verbs — only the
 * label distinguishes them, so they must look identical. */
const SESSION_BUTTON_CLASS =
  "inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border bg-secondary text-sm font-medium text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80 disabled:pointer-events-none disabled:opacity-50";

type Status =
  | "idle"
  | "saving"
  | "saved"
  | "savingSession"
  | "savingSessionKeepOpen"
  | "sessionSaved"
  | "error";

export default function App() {
  // `null` = auth still loading; the gate/full UI only render once it resolves.
  const [auth, setAuth] = useState<UserInfo | null>(null);
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
  // Set only when the boot timeout fires before any background answer — surfaces
  // a note on the gate so a stuck background reads as a state, not a bug.
  const [degraded, setDegraded] = useState(false);
  // A session save still running after SLOW_SAVE_MS — swaps the silent spinner for
  // a "still working, your tabs are safe" line.
  const [slowSave, setSlowSave] = useState(false);

  // Auth check on open (popup mount) + a re-check whenever the popup regains
  // visibility — e.g. returning from the sign-in tab.
  useEffect(() => {
    diag("popup", "mount");
    void probeBackground();
    let alive = true;
    let responded = false;
    const check = () => {
      void requestUser().then((info) => {
        if (!alive) return;
        responded = true;
        diag("popup", "auth resolved", { signedIn: info.signedIn });
        setAuth(info);
      });
    };
    check();
    // Safety net: if the background never answers within the budget, stop
    // spinning and show the signed-out gate. The 2s auth poll below keeps
    // retrying, so a later recovery or a real sign-in still promotes the popup.
    const bootTimer = window.setTimeout(() => {
      if (!alive || responded) return;
      diag("popup", "boot timeout fired");
      setDegraded(true);
      setAuth(SIGNED_OUT);
    }, BOOT_TIMEOUT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearTimeout(bootTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Poll ONLY while the signed-out gate is showing. `auth?.signedIn` stays false
  // across signed-out re-checks, so the interval persists; it clears the moment
  // sign-in flips it true (or while auth is still loading/undefined).
  useEffect(() => {
    if (!auth || auth.signedIn) return;
    const id = window.setInterval(() => {
      void requestUser().then((info) => {
        diag("popup", "poll", { signedIn: info.signedIn });
        setAuth(info);
      });
    }, AUTH_POLL_MS);
    return () => window.clearInterval(id);
  }, [auth?.signedIn]);

  useEffect(() => {
    void browser.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
      if (active?.url) {
        setTab({ url: active.url, title: active.title, favIconUrl: active.favIconUrl });
      }
    });
    // Count restorable tabs in THIS window for the session button labels —
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
    const timer = setTimeout(() => window.close(), AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [status]);

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
    // A save that outlives the button spinner gets a line of reassurance —
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

  function openApp() {
    void browser.tabs.create({ url: `${webUrl}/app` });
    window.close();
  }

  // Auth still resolving — a bare frame so we neither flash the save UI nor the
  // sign-in gate before we know which one to show.
  if (!auth) {
    return (
      <div className="flex min-w-[20rem] items-center justify-center p-8">
        <Spinner />
      </div>
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
  const tabSuffix = tabCount ? ` (${tabLabel})` : "";

  return (
    <div className="flex min-w-[20rem] flex-col gap-3 p-4">
      <header className="flex items-center gap-2">
        <img src={iconUrl()} alt="" className="size-8 shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-sm font-semibold leading-tight tracking-tight">
            Bookmark AI
          </h1>
          {/* Subtext: the masked email with a hover reveal; no email → the name,
              unmasked and with no reveal control. */}
          {auth.email ? (
            <MaskedEmail email={auth.email} />
          ) : (
            <p className="truncate text-[11px] leading-tight text-muted-foreground">
              {auth.name ?? "Account"}
            </p>
          )}
        </div>
        <SignOutButton webUrl={webUrl} onSignedOut={() => setAuth(SIGNED_OUT)} />
      </header>

      {status === "saved" && bookmark ? (
        <SavedResult bookmark={bookmark} />
      ) : status === "sessionSaved" && session ? (
        <SessionSavedResult session={session} />
      ) : (
        <>
          {/* Primary action 1 — bookmark the current tab. */}
          <SaveCard
            tab={tab}
            saving={status === "saving"}
            disabled={!savable || busy}
            onSave={() => void handleSaveBookmark()}
          />

          {/* Primary actions 2 and 3 — same snapshot, one keeps the window.
              The non-destructive verb comes first; the destructive one last. */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void handleSaveSession(true)}
              disabled={busy || !tabCount}
              className={SESSION_BUTTON_CLASS}
            >
              {status === "savingSessionKeepOpen" && <Spinner />}
              {status === "savingSessionKeepOpen"
                ? "Saving session…"
                : `Save session & keep open${tabSuffix}`}
            </button>

            <button
              type="button"
              onClick={() => void handleSaveSession(false)}
              disabled={busy || !tabCount}
              className={SESSION_BUTTON_CLASS}
            >
              {status === "savingSession" && <Spinner />}
              {status === "savingSession" ? "Saving session…" : `Save session & close${tabSuffix}`}
            </button>

            {/* Only after SLOW_SAVE_MS. On the closing path it doubles as the
                promise we actually keep: the window is closed AFTER the server
                confirms the save, never before. */}
            {slowSave && (
              <p className="px-0.5 text-[11px] leading-snug text-muted-foreground" role="status">
                {status === "savingSession"
                  ? `Saving ${tabLabel}… your tabs stay open until the save is confirmed.`
                  : `Saving ${tabLabel}… hang on.`}
              </p>
            )}
          </div>
        </>
      )}

      {status === "error" && error && <ErrorNote message={error} />}

      {/* Quiet tier: a secondary, mostly-set-once control. It sits below the save
          actions and reads as a settings row, not a fourth button. */}
      <LiveTabsToggle />

      <footer className="mt-1 flex items-center justify-between gap-2 border-t pt-2">
        <SettingsButton webUrl={webUrl} />
        <button
          type="button"
          onClick={openApp}
          className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Open App ↗
        </button>
      </footer>
    </div>
  );
}
