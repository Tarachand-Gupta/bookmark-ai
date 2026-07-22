import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { Bookmark, Session } from "@bookmark-ai/types";
import { DEFAULT_WEB_URL, getWebBaseUrl } from "@/lib/api";
import { iconUrl } from "@/lib/icon";
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

const SIGNED_OUT: UserInfo = { signedIn: false, name: null, email: null };

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
  const [status, setStatus] = useState<Status>("idle");
  const [bookmark, setBookmark] = useState<Bookmark | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webUrl, setWebUrl] = useState<string>(DEFAULT_WEB_URL);

  // Auth check on open (popup mount) + a re-check whenever the popup regains
  // visibility — e.g. returning from the sign-in tab.
  useEffect(() => {
    let alive = true;
    const check = () => {
      void requestUser().then((info) => {
        if (alive) setAuth(info);
      });
    };
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Poll ONLY while the signed-out gate is showing. `auth?.signedIn` stays false
  // across signed-out re-checks, so the interval persists; it clears the moment
  // sign-in flips it true (or while auth is still loading/undefined).
  useEffect(() => {
    if (!auth || auth.signedIn) return;
    const id = window.setInterval(() => {
      void requestUser().then(setAuth);
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
    setStatus(keepOpen ? "savingSessionKeepOpen" : "savingSession");
    setError(null);
    // Scope the session to the popup's window; the background can't resolve
    // "current window" reliably from its own context.
    const win = await browser.windows.getCurrent();
    const result = await requestSaveSession({ windowId: win.id, keepOpen });
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

  // Signed out: the gate is the ONLY thing the popup shows.
  if (!auth.signedIn) {
    return <SignInGate webUrl={webUrl} />;
  }

  const savable = tab !== null && /^https?:/i.test(tab.url);
  const busy =
    status === "saving" || status === "savingSession" || status === "savingSessionKeepOpen";
  const tabSuffix = tabCount ? ` (${tabCount} tab${tabCount === 1 ? "" : "s"})` : "";

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
        <SignOutButton onSignedOut={() => setAuth(SIGNED_OUT)} />
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
          </div>
        </>
      )}

      {status === "error" && error && <ErrorNote message={error} />}

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
