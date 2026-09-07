/**
 * SAFARI ONLY — tell the Mac companion app who is signed in.
 *
 * The Safari build ships inside a Mac app (apps/extension/safari-app) whose setup
 * window and menu-bar item used to know only Safari's on/off verdict for the
 * extension; they could not tell whether the user was signed in, so the window
 * kept saying "Sign in once on the web" next to a signed-in popup. This module
 * is the channel: whenever the background resolves the user (popup `GET_USER`),
 * mints a device token, signs out, or runs the 6h auth tick, it sends
 *
 *   { type: "authState", signedIn, email?, name?, at }
 *
 * to the appex over `browser.runtime.sendNativeMessage`, and
 * `SafariWebExtensionHandler` (safari-app/Extension) writes it into the App
 * Group suite the companion reads (safari-app/Shared/AuthStateStore.swift).
 *
 * Rules:
 *  - Safari target ONLY (`import.meta.env.BROWSER === "safari"` — inlined by the
 *    bundler, so the Chrome/Firefox bundles early-return; their manifests carry
 *    no `nativeMessaging` permission and their behaviour is unchanged).
 *  - NEVER a token or cookie — the report is identity for display, nothing else.
 *  - Deduped: one send per boot for a given (signedIn, email) pair; repeats are
 *    skipped unless `force` (the 6h tick forces so the companion's `updatedAt`
 *    stays fresh and a wiped App Group suite heals within six hours).
 *    (Tailwind scans this file for class names — comments avoid bare utility
 *    words like the c-word for a box that holds things.)
 *  - Bounded and harmless: 5 s timeout, every failure is caught and only leaves
 *    a `diag` breadcrumb — a broken native host can never affect auth.
 *
 * Pure helpers + the injectable `deps` exist so `native-auth-report.test.ts`
 * covers the dedupe and the non-Safari no-op without a real Safari.
 */
import { browser } from "wxt/browser";
import { diag } from "@/lib/diag";

export interface AuthStateInput {
  signedIn: boolean;
  email?: string | null;
  name?: string | null;
}

/** The wire shape the appex parses (`AuthStateStore.parse`). Keep in sync. */
export interface AuthStateReport {
  type: "authState";
  signedIn: boolean;
  email?: string;
  name?: string;
  /** ISO-8601 (`Date.toISOString()`) — the companion shows staleness from it. */
  at: string;
}

export type AuthReportOutcome = "sent" | "skipped" | "unsupported" | "failed";

export type NativeSender = (application: string, message: AuthStateReport) => Promise<unknown>;

export interface AuthReportDeps {
  /** Defaults to the inlined build constant; tests pass "safari"/"chrome". */
  browserName?: string;
  /** Defaults to `browser.runtime.sendNativeMessage`; `null` = API absent. */
  send?: NativeSender | null;
  now?: () => Date;
}

/** Safari ignores the application argument (the appex is implied); Chrome/Firefox
 * never get here. Kept meaningful for logs. */
export const NATIVE_APP_ID = "ai.bookmark.safari";
export const NATIVE_REPORT_TIMEOUT_MS = 5_000;

let lastSentKey: string | null = null;

/** Dedupe identity: signed-out is one state regardless of who it was; signed-in
 * is keyed by the (case-folded) e-mail so a later resolve that ADDS the address
 * (mint-success path reports before identity is known) still goes out. */
export function authReportKey(state: AuthStateInput): string {
  return state.signedIn ? `in|${(state.email ?? "").trim().toLowerCase()}` : "out";
}

/** Build the wire message. Only the four documented fields can ever appear —
 * whatever else the caller's object carries is dropped, and a signed-out report
 * carries no identity at all. */
export function buildAuthStateReport(state: AuthStateInput, now: Date = new Date()): AuthStateReport {
  const report: AuthStateReport = { type: "authState", signedIn: state.signedIn, at: now.toISOString() };
  if (state.signedIn) {
    if (state.email) report.email = state.email;
    if (state.name) report.name = state.name;
  }
  return report;
}

/** Test hook: a fresh worker boot has no dedupe memory. */
export function resetAuthReportDedupe(): void {
  lastSentKey = null;
}

function defaultSender(): NativeSender | null {
  const runtime = (browser as unknown as { runtime?: { sendNativeMessage?: unknown } }).runtime;
  const fn = runtime?.sendNativeMessage;
  if (typeof fn !== "function") return null;
  return (application, message) =>
    (fn as (app: string, msg: unknown) => Promise<unknown>).call(runtime, application, message);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sendNativeMessage timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Report the resolved sign-in state to the companion app. Resolves to what
 * happened; never rejects. Fire-and-forget from the background (`void`).
 */
export async function reportAuthState(
  state: AuthStateInput,
  options: { force?: boolean } = {},
  deps: AuthReportDeps = {},
): Promise<AuthReportOutcome> {
  const browserName = deps.browserName ?? import.meta.env.BROWSER;
  if (browserName !== "safari") return "unsupported";
  const send = deps.send === undefined ? defaultSender() : deps.send;
  if (!send) return "unsupported";

  const key = authReportKey(state);
  if (!options.force && key === lastSentKey) return "skipped";

  const report = buildAuthStateReport(state, deps.now?.() ?? new Date());
  try {
    await withTimeout(send(NATIVE_APP_ID, report), NATIVE_REPORT_TIMEOUT_MS);
    lastSentKey = key;
    diag("nativeAuth", "reported", { signedIn: report.signedIn, hasEmail: !!report.email, force: !!options.force });
    return "sent";
  } catch (e) {
    // Not latched: the next state resolve retries. Never surfaces to auth.
    diag("nativeAuth", "report failed", { error: e instanceof Error ? e.message : String(e) });
    return "failed";
  }
}
