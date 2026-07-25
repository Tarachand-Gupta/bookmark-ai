import { browser } from "wxt/browser";
import type { PushLiveStateInput } from "@bookmark-ai/types";
import { detectBrowser, detectDevice, detectOs } from "./detect";
import { diag } from "./diag";
import { getDeviceId, getDeviceLabel } from "./device-id";
import { pushLiveState, updateLiveSettings, type PushOutcome } from "./live-api";
import { buildLiveWindows, type LiveInputWindow } from "./live-sanitize";
import {
  liveBackoffStepItem,
  liveBackoffUntilItem,
  liveDirtyItem,
  liveEnabledItem,
} from "./live-storage";
import {
  getNewWindowsPolicy,
  isWindowShared,
  migrateLegacyExclusions,
  overrideExistingWindowsShared,
  pruneWindowOverrides,
  resolveWindowShared,
  setNewWindowsPolicy,
} from "./live-windows";

/**
 * The event-driven, debounced live-tabs push loop (§4.1 rework, §4.5).
 *
 * Tab/window events are a TRIGGER, never a data source: each one just sets a
 * dirty flag and (re)arms a 5s trailing debounce. When the debounce fires, a
 * single full `windows.getAll` scan is sanitized (§5.3) and POSTed — so a burst
 * (20 tabs opened, 5 closed) collapses into ONE push 5s after the last change.
 * A `chrome.alarms` heartbeat (~2 min) re-stamps liveness when idle and retries a
 * debounce a killed worker dropped. All durable state is in chrome.storage.local
 * (`liveEnabled`/`liveDirty`/backoff); the enabled flag is re-read on every wake.
 */

const DEBOUNCE_MS = 5_000;
const HEARTBEAT_ALARM = "live-heartbeat";
const HEARTBEAT_PERIOD_MINUTES = 2; // backstop: re-stamp liveness + retry a dropped debounce
// 1m→2m→5m→15m→30m (§4.5). Safari caps at 5m: its worker restarts constantly,
// so a transient failure (e.g. no bridge tab open to mint a live token) is
// common and must not freeze the mirror for half an hour once conditions heal.
const BACKOFF_SCHEDULE_MS =
  import.meta.env.BROWSER === "safari"
    ? [60_000, 120_000, 300_000]
    : [60_000, 120_000, 300_000, 900_000, 1_800_000];
const BADGE_COLOR = "#2563eb";
const MAX_OS = 40; // pushLiveStateSchema.os cap

/**
 * The only worker-local values, and neither is durable state: a transient timer
 * handle (meaningless once the worker dies — the dirty flag + heartbeat alarm are
 * what actually survive) and a re-entrancy guard so an alarm and a debounce can't
 * push at the same time. Everything that must persist lives in chrome.storage.local.
 */
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let flushing = false;

interface BadgeAction {
  setBadgeText: (details: { text: string }) => Promise<void> | void;
  setBadgeBackgroundColor?: (details: { color: string }) => Promise<void> | void;
}

/** `browser.action` on MV3, `browser.browserAction` on MV2 — cast like the
 * TabGroupApis pattern in background.ts rather than widen the polyfill types. */
function badgeAction(): BadgeAction | undefined {
  const api = browser as unknown as {
    action?: BadgeAction;
    browserAction?: BadgeAction;
  };
  return api.action ?? api.browserAction;
}

/**
 * Manufacture the ambient "this device is publishing" signal the browser itself
 * never shows (§5.2) — a colored dot on the toolbar icon. No permission required,
 * and it is the one control standing between "a feature" and "a thing that can be
 * turned on against someone", so it is not optional polish.
 */
async function setBadge(publishing: boolean): Promise<void> {
  const action = badgeAction();
  if (!action) return;
  try {
    if (publishing) {
      await action.setBadgeText({ text: "●" });
      await action.setBadgeBackgroundColor?.({ color: BADGE_COLOR });
    } else {
      await action.setBadgeText({ text: "" });
    }
  } catch {
    // badge is best-effort; never let it break a push
  }
}

function clearDebounce(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
}

function armDebounce(): void {
  clearDebounce();
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    void flush("debounce");
  }, DEBOUNCE_MS);
}

async function ensureAlarm(): Promise<void> {
  // Re-creating an alarm of the same name just resets it — idempotent.
  await browser.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_PERIOD_MINUTES });
}

async function clearAlarm(): Promise<void> {
  await browser.alarms.clear(HEARTBEAT_ALARM);
}

async function resetBackoff(): Promise<void> {
  await liveBackoffStepItem.setValue(0);
  await liveBackoffUntilItem.setValue(0);
}

async function bumpBackoff(): Promise<void> {
  const step = await liveBackoffStepItem.getValue();
  const delay = BACKOFF_SCHEDULE_MS[Math.min(step, BACKOFF_SCHEDULE_MS.length - 1)]!;
  await liveBackoffUntilItem.setValue(Date.now() + delay);
  await liveBackoffStepItem.setValue(Math.min(step + 1, BACKOFF_SCHEDULE_MS.length - 1));
}

async function baseState(): Promise<Omit<PushLiveStateInput, "windows" | "hiddenTabCount">> {
  const os = detectOs();
  return {
    deviceId: await getDeviceId(),
    label: await getDeviceLabel(),
    browser: detectBrowser(),
    device: detectDevice(),
    os: os ? os.slice(0, MAX_OS) : null,
    capturedAt: new Date().toISOString(),
  };
}

/** Full scan → sanitized payload (with windows). The only data source; no listener
 * ever builds a payload (§4.1). */
async function buildFullPush(): Promise<PushLiveStateInput> {
  const windows = (await browser.windows.getAll({ populate: true })) as LiveInputWindow[];
  // Keep only windows that are SHARED (explicit override, else the device policy)
  // BEFORE building the payload, so tab and hidden counts reflect only what's
  // actually shared (a window filtered here never contributes to hiddenTabCount).
  // Prune the override map first, against the ids we just scanned, so it can't
  // accumulate closed-window ids over time.
  const ids = windows.map((w) => w.id).filter((id): id is number => typeof id === "number");
  const [overrides, policy] = await Promise.all([pruneWindowOverrides(ids), getNewWindowsPolicy()]);
  const shared = windows.filter((w) => resolveWindowShared(overrides, policy, w.id));
  const built = buildLiveWindows(shared);
  return { ...(await baseState()), hiddenTabCount: built.hiddenTabCount, windows: built.windows };
}

/** Mirror the device new-window policy the server echoed on a successful push, so
 * the popup + checkpoint filter see policy changes made in the web app (picked up
 * within ~2min via the heartbeat even when idle). No-op when the body omitted it. */
async function mirrorPolicy(outcome: PushOutcome): Promise<void> {
  if (outcome.ok && typeof outcome.newWindowsShared === "boolean") {
    await setNewWindowsPolicy(outcome.newWindowsShared);
  }
}

/** Turn a non-ok push into the right silent reaction. */
async function reactToFailure(outcome: Extract<PushOutcome, { ok: false }>): Promise<void> {
  if (outcome.disabled) {
    // The account flag was turned off elsewhere (§5.2). The server already purged
    // our row, so just stop locally — no delete needed.
    await stopLocally();
  } else {
    await bumpBackoff(); // transient (network/401/429/5xx) — silent, retried by the heartbeat
  }
}

/**
 * Deliver current state. `reason` decides heartbeat vs full push; both re-read the
 * enabled flag and honor the backoff clock. Guarded so an alarm and a debounce
 * never push concurrently (a skipped one re-arms, so nothing is lost).
 */
async function flush(reason: "debounce" | "alarm" | "windowRemoved"): Promise<void> {
  if (!(await liveEnabledItem.getValue())) {
    // Off costs zero: clear any residue and make sure the alarm isn't firing.
    await liveDirtyItem.setValue(false);
    await clearAlarm();
    await setBadge(false);
    return;
  }
  const backoffUntil = await liveBackoffUntilItem.getValue();
  if (Date.now() < backoffUntil) {
    diag("live", "flush skipped (backoff)", { reason, remainingMs: backoffUntil - Date.now() });
    return;
  }
  if (flushing) {
    armDebounce(); // a push is in flight; retry after it settles
    return;
  }

  flushing = true;
  try {
    const dirty = await liveDirtyItem.getValue();

    if (reason === "alarm" && !dirty) {
      // Heartbeat: re-stamp liveness WITHOUT touching the mirror — windows OMITTED
      // (absent = heartbeat; sending [] would wipe the mirror, §4.3).
      const outcome = await pushLiveState({ ...(await baseState()), hiddenTabCount: 0 });
      diag("live", "heartbeat push", { ok: outcome.ok });
      if (outcome.ok) {
        await resetBackoff();
        await mirrorPolicy(outcome);
      } else await reactToFailure(outcome);
      return;
    }

    // Full push, at-least-once: clear dirty FIRST so a change arriving mid-push
    // re-sets it and is not swallowed by this success.
    await liveDirtyItem.setValue(false);
    const outcome = await pushLiveState(await buildFullPush());
    diag("live", "full push", { reason, ok: outcome.ok });
    if (outcome.ok) {
      await resetBackoff();
      await mirrorPolicy(outcome);
    } else {
      await liveDirtyItem.setValue(true); // failed — keep the pending change for retry
      await reactToFailure(outcome);
    }
  } finally {
    flushing = false;
  }
}

/** Stop publishing on THIS device: drop local state, alarm, and badge. Used by the
 * off toggle and by a server 403 (account revoked). */
async function stopLocally(): Promise<void> {
  clearDebounce();
  await liveEnabledItem.setValue(false);
  await liveDirtyItem.setValue(false);
  await resetBackoff();
  await clearAlarm();
  await setBadge(false);
}

export interface LiveEnabledResult {
  ok: boolean;
  enabled: boolean;
}

/**
 * The popup's toggle, executed in the background (which holds the Clerk token).
 * Writes the local mirror AND the account flag (§4.9): on = activate this device +
 * arm the account + push now; off = stop locally immediately, then purge the
 * account server-side (§5.7). The local flag flips first, so "off" takes effect
 * without waiting for the network.
 */
export async function setLiveEnabled(enabled: boolean): Promise<LiveEnabledResult> {
  if (!enabled) {
    await stopLocally();
    const ok = await updateLiveSettings({ enabled: false });
    return { ok, enabled: false };
  }

  await liveEnabledItem.setValue(true);
  // Enable-time window treatment: windows OPEN right now are treated as existing
  // shared windows (explicit override → true), so turning live on actually shows
  // something even if this device's policy is OFF. Only windows created AFTER this
  // carry no override and follow the policy. Incognito windows are skipped — the
  // sanitizer drops their content anyway, so an override for them is meaningless.
  try {
    const wins = await browser.windows.getAll();
    await overrideExistingWindowsShared(
      wins
        .filter((w) => !w.incognito)
        .map((w) => w.id)
        .filter((id): id is number => typeof id === "number"),
    );
  } catch {
    // best-effort — a scan failure just means those windows follow the policy
  }
  await setBadge(true);
  await ensureAlarm();
  const armed = await updateLiveSettings({ enabled: true });
  if (!armed) {
    // Couldn't arm the account — pushes would 403. Roll back to a clean off.
    await stopLocally();
    return { ok: false, enabled: false };
  }

  // Kick an immediate first push so the device appears without waiting for a change.
  await liveDirtyItem.setValue(true);
  await resetBackoff();
  await flush("debounce");
  const stillOn = await liveEnabledItem.getValue();
  return { ok: stillOn, enabled: stillOn };
}

/**
 * Force an immediate full push, bypassing the 5s debounce — for a change that
 * carries NO tab event (a device rename writes only storage.local, and the
 * ~2min heartbeat deliberately doesn't touch the mirror, §4.3). Marks dirty and
 * flushes now; the `flushing` guard inside `flush` still serializes it against
 * an in-flight push. No-op when publishing is off.
 */
export async function pushLiveNow(): Promise<void> {
  if (!(await liveEnabledItem.getValue())) return;
  await liveDirtyItem.setValue(true);
  await flush("debounce");
}

/**
 * Register every listener SYNCHRONOUSLY (§4.5) — a listener behind an await never
 * wakes the MV3 worker. Each listener does two things only: filter incognito where
 * the event exposes it (§5.3), then mark dirty + arm the debounce. It never reads
 * tabs or builds a payload; the flush does the full re-scan.
 */
export function registerLiveCheckpoint(): void {
  const markDirty = (windowId?: number): void => {
    void onChange(windowId);
  };
  const markDirtyUnlessPrivate = (context?: { incognito?: boolean; windowId?: number }): void => {
    if (context?.incognito) return; // never even wake for private activity where we can tell
    void onChange(context?.windowId);
  };

  // Optional chaining on every event: a browser that doesn't expose one of these
  // (Safari omits some tabs/windows events) just skips that listener rather than
  // throwing on `.addListener` and aborting the whole registration.
  //
  // Every listener that can name its window cheaply forwards the id so `onChange`
  // can drop the change when that window is EXCLUDED — an excluded window is
  // filtered out of the payload anyway (buildFullPush), so marking dirty for it
  // would only schedule a push that rebuilds to identical output. onReplaced
  // exposes no window id, so it falls back to an unconditional mark (its full
  // re-scan still filters correctly — just possibly one redundant push).
  browser.tabs.onCreated?.addListener((tab) =>
    markDirtyUnlessPrivate({ incognito: tab.incognito, windowId: tab.windowId }),
  );
  browser.tabs.onUpdated?.addListener((_tabId, changeInfo, tab) => {
    // Only changes that alter the tab set or its display fields; the debounce
    // coalesces the loading→title→favicon→complete burst into one push.
    if (
      changeInfo.url === undefined &&
      changeInfo.title === undefined &&
      changeInfo.favIconUrl === undefined &&
      changeInfo.status === undefined
    ) {
      return;
    }
    markDirtyUnlessPrivate({ incognito: tab.incognito, windowId: tab.windowId });
  });
  // onRemoved/onMoved/onAttached/onDetached/onReplaced carry no incognito flag; the
  // flush re-scan excludes incognito data, so the payload is safe regardless.
  browser.tabs.onRemoved?.addListener((_tabId, info) => markDirty(info?.windowId));
  browser.tabs.onMoved?.addListener((_tabId, info) => markDirty(info?.windowId));
  browser.tabs.onAttached?.addListener((_tabId, info) => markDirty(info?.newWindowId));
  browser.tabs.onDetached?.addListener((_tabId, info) => markDirty(info?.oldWindowId));
  browser.tabs.onReplaced?.addListener(() => markDirty());
  // A brand-new window has no override, so forwarding its id makes `onChange`
  // judge it by the device policy: policy ON → push so it appears in the mirror;
  // policy OFF → skip (it isn't shared, so a push would rebuild to identical
  // filtered output). Enabling live overrides pre-existing windows to shared, so
  // this only gates windows opened AFTER live was turned on.
  browser.windows.onCreated?.addListener((win) =>
    markDirtyUnlessPrivate({ incognito: win.incognito, windowId: win.id }),
  );
  browser.windows.onRemoved?.addListener(() => {
    void onWindowRemoved();
  });

  browser.alarms.onAlarm?.addListener((alarm) => {
    if (alarm.name === HEARTBEAT_ALARM) void flush("alarm");
  });

  void bootReconcile();
}

async function onChange(windowId?: number): Promise<void> {
  if (!(await liveEnabledItem.getValue())) return; // off costs zero (§5.2)
  // When the change is cheaply attributable to a NON-SHARED window it can't alter
  // the shared payload, so skip the dirty flag + debounce entirely rather than
  // schedule a push that would rebuild to identical filtered output. A brand-new
  // window (no override) is judged by the device policy, so a change in it is
  // skipped when the policy is OFF and honored when it's ON.
  if (typeof windowId === "number" && !(await isWindowShared(windowId))) return;
  await liveDirtyItem.setValue(true);
  armDebounce();
}

async function onWindowRemoved(): Promise<void> {
  if (!(await liveEnabledItem.getValue())) return;
  await liveDirtyItem.setValue(true);
  clearDebounce(); // the window is already gone (§4.1) — flush now, don't wait 5s
  await flush("windowRemoved");
}

/**
 * On every worker boot, keep the alarm + badge consistent (a restart may have
 * dropped them) and retry a debounce the previous worker died mid-way through.
 * Never forces a push on a clean boot — dirty gates the retry.
 */
async function bootReconcile(): Promise<void> {
  // Fold the old exclusion list into the override map once per boot, then it's
  // gone (idempotent — a cheap empty-read + remove after the first run).
  await migrateLegacyExclusions().catch(() => {});
  if (!(await liveEnabledItem.getValue())) {
    await clearAlarm();
    await setBadge(false);
    return;
  }
  await ensureAlarm();
  await setBadge(true);
  if (await liveDirtyItem.getValue()) await flush("alarm");
}
