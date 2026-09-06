import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { getAppReleases, SERVER_TARGET } from "../api";
import {
  bannerFor,
  parseSnooze,
  snoozeRelease,
  type AppPlatform,
  type AppRelease,
  type InstalledVersion,
  type UpdateBannerModel,
  type UpdateSnooze,
} from "../lib/appUpdate";

/**
 * "Later" for one release, persisted per server target (like the other caches):
 * the local dev server's fixture record and production's real one are different
 * releases, and a snooze on one must not speak for the other.
 */
const SNOOZE_KEY = `bookmark-ai:app-update-snooze:${SERVER_TARGET}`;

/** The releases endpoint is a nicety, never a gate — give up fast and silently. */
const FETCH_TIMEOUT_MS = 5_000;

/** §12: re-check on launch and every 6 h while running. */
const REFRESH_MS = 6 * 60 * 60 * 1000;

/** Which record in `{releases}` speaks for this build. Web/other ⇒ none. */
const PLATFORM: AppPlatform | null =
  Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : null;

/**
 * What this binary reports about itself — CFBundleShortVersionString +
 * CFBundleVersion on iOS, versionName + versionCode on Android (`app.json`
 * `version` / `ios.buildNumber` / `android.versionCode`, baked in at build
 * time). Read through expo-application: SDK 57's expo-constants no longer
 * carries `nativeAppVersion`/`nativeBuildVersion` (removed, not just
 * deprecated). Null when the host has no app version to report (Expo Go's is
 * Expo Go's, not ours) — then there is nothing to compare and never a banner.
 */
const INSTALLED: InstalledVersion | null = Application.nativeApplicationVersion
  ? {
      version: Application.nativeApplicationVersion,
      build: Application.nativeBuildVersion ?? null,
    }
  : null;

export interface AppUpdateState {
  /** Null ⇒ render nothing. */
  banner: UpdateBannerModel | null;
  /** "Later": hide this release for 24 h (persisted). Ignored while `unsupported`. */
  snooze: () => void;
}

/**
 * The update banner's data story (CONTRACT §12): `GET /api/app/releases` on
 * launch, again when the app comes to the foreground after 6 h, and on a 6 h
 * timer while it stays up; the platform record is compared with the installed
 * version and gated by the persisted 24 h snooze. Every failure — offline, a
 * 5xx, a slow server, a body that isn't the contract — resolves to "no banner".
 *
 * Mounted by Home (always mounted from launch, so this is "on app start").
 * Coming back to the foreground re-evaluates the snooze too, which is how the
 * banner returns "again on app foreground after the snooze expires" without a
 * network round trip.
 */
export function useAppUpdate(): AppUpdateState {
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [snooze, setSnooze] = useState<UpdateSnooze | null>(null);
  // Set once the persisted snooze has been read — before that the banner stays
  // hidden, so a relaunch inside the 24 h never flashes it.
  const [hydrated, setHydrated] = useState(false);
  // Bumped on foreground / the timer so an expired snooze is re-evaluated.
  const [now, setNow] = useState(() => Date.now());
  const fetchedAt = useRef(0);
  // Guards stale async writes: only the newest fetch may touch state.
  const runId = useRef(0);

  const load = useCallback(() => {
    if (PLATFORM === null || INSTALLED === null) return;
    const id = ++runId.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    getAppReleases(controller.signal)
      .then((response) => {
        if (runId.current !== id) return;
        fetchedAt.current = Date.now();
        setRelease(response.releases[PLATFORM] ?? null);
        setNow(Date.now());
      })
      .catch(() => {
        // Silent by contract: no record, no network, no banner. A previously
        // fetched record stays — the 6 h refresh will replace it.
      })
      .finally(() => clearTimeout(timer));
  }, []);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SNOOZE_KEY)
      .then((raw) => {
        if (cancelled) return;
        setSnooze(parseSnooze(raw));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      setNow(Date.now());
      if (Date.now() - fetchedAt.current >= REFRESH_MS) load();
    });
    // JS timers pause in the background on both platforms; the foreground
    // handler above covers a long suspend, this covers a long foreground.
    const interval = setInterval(() => {
      setNow(Date.now());
      load();
    }, REFRESH_MS);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [load]);

  const snoozeCurrent = useCallback(() => {
    if (release === null) return;
    const record = snoozeRelease(release, Date.now());
    setSnooze(record);
    setNow(Date.now());
    void AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify(record)).catch(() => undefined);
  }, [release]);

  const banner = hydrated ? bannerFor({ current: INSTALLED, release, snooze, now }) : null;
  return { banner, snooze: snoozeCurrent };
}
