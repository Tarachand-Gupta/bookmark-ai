"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getSettings, updateSettings } from "@/lib/api";
import { FEATURE_ICONS } from "./feature-icons";
import { Switch } from "./devices-settings";
import { SettingsGroup, SettingsRow, SettingsSection } from "./settings-section";

/** Canonical bookmarks glyph, shared with the sidebar via FEATURE_ICONS. */
const SyncIcon = FEATURE_ICONS.bookmarks;

/**
 * Settings → Sync. Mirror native browser bookmarks (and Chrome's Reading List)
 * into the library. Adding is on by default; "full sync" (removals delete the
 * saved copy too) is off by default. Server-stored in user_settings, so the
 * toggles follow the account across every installed extension — each extension
 * polls GET /api/settings into local storage and re-reads it per-wake.
 * Not available in Safari: Apple's extension API exposes neither bookmarks nor
 * the Reading List.
 */
export function SyncSection() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [fullSync, setFullSync] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then(({ settings }) => {
        if (cancelled) return;
        setSyncEnabled(settings.nativeSyncEnabled);
        setFullSync(settings.nativeSyncFull);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Optimistic single-field PATCH; revert the other state on failure. */
  const apply = async (
    patch: { nativeSyncEnabled?: boolean; nativeSyncFull?: boolean },
    revert: () => void,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const { settings } = await updateSettings(patch);
      setSyncEnabled(settings.nativeSyncEnabled);
      setFullSync(settings.nativeSyncFull);
    } catch (e) {
      setError((e as Error).message);
      revert();
    } finally {
      setBusy(false);
    }
  };

  const toggleSync = (next: boolean) => {
    const prevSync = syncEnabled;
    const prevFull = fullSync;
    setSyncEnabled(next);
    // Turning the master switch off also snaps full sync off — it means nothing
    // without mirroring, and leaving it on would surprise the user if they
    // later re-enable sync.
    if (!next) setFullSync(false);
    void apply(
      next ? { nativeSyncEnabled: true } : { nativeSyncEnabled: false, nativeSyncFull: false },
      () => {
        setSyncEnabled(prevSync);
        setFullSync(prevFull);
      },
    );
  };

  const toggleFull = (next: boolean) => {
    const prev = fullSync;
    setFullSync(next);
    void apply({ nativeSyncFull: next }, () => setFullSync(prev));
  };

  return (
    <SettingsSection
      title="Browser bookmarks & reading list"
      icon={SyncIcon}
      description="Mirror bookmarks you add in Chrome or Firefox — and items you add to Chrome’s Reading List — into your library here. Applies to every browser where you’re signed in to the extension."
    >
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : (
        <>
          <SettingsRow
            label="Sync native browser bookmarks"
            htmlFor="native-sync-enabled"
            control={
              <Switch
                id="native-sync-enabled"
                checked={syncEnabled}
                disabled={busy}
                onChange={toggleSync}
              />
            }
            description={
              <>
                Bookmarking a page the usual way (the star button, Ctrl/Cmd+D, or the bookmarks
                menu) also saves it here, categorized and searchable. Reading List additions are
                saved with the <strong className="font-medium text-foreground">reading</strong>{" "}
                and <strong className="font-medium text-foreground">article</strong> tags. On by
                default. Not available in Safari — Apple doesn&apos;t expose bookmarks or the
                Reading List to extensions.
              </>
            }
          />

          <SettingsGroup divided>
            {/* Gated on the master switch, so the label dims with it — the row
                primitive owns that state instead of two spelled-out classNames. */}
            <SettingsRow
              label="Full sync — apply removals too"
              htmlFor="native-sync-full"
              muted={!syncEnabled}
              control={
                <Switch
                  id="native-sync-full"
                  checked={fullSync}
                  disabled={busy || !syncEnabled}
                  onChange={toggleFull}
                />
              }
              description="Removing a native bookmark or Reading List item also deletes it from Bookmark AI. Off by default — removals normally keep the saved copy, so this library only grows unless you opt in. Clearing a whole folder deletes only the bookmarks the browser reports (a folder removal reports the folder, not its contents)."
            />
          </SettingsGroup>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}
    </SettingsSection>
  );
}
