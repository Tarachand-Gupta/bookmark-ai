/** The Settings → Appearance choice; "system" follows the OS. Persisted. */
export type ThemePreference = "system" | "light" | "dark";

/** What `useColorScheme()` reports (RN's ColorSchemeName): "unspecified"/null/
 * undefined while unknown — anything but "dark" renders light. */
export type SystemScheme = "light" | "dark" | "unspecified" | null | undefined;

/**
 * Whether the app renders dark, given the user's preference and the OS scheme.
 * Kept pure (and out of the provider) so the one rule every surface depends on
 * is unit-tested; PreferencesProvider feeds it the live `useColorScheme()`.
 *
 * Live updates are the provider's job, but one platform trap is worth recording
 * here because it looked like a bug in THIS rule: on iOS, React Native only
 * learns of an OS appearance change through the root surface view's
 * `traitCollectionDidChange` — no Modal host view controller forwards it — and
 * UIKit detaches that root view from the window while a `presentationStyle=
 * "fullScreen"` modal is up. So `useColorScheme()` froze for as long as Settings
 * (or a chat thread) was presented and caught up only on dismiss. The
 * presentations use `overFullScreen` for that reason; do not switch them back.
 */
export function resolveDark(preference: ThemePreference, system: SystemScheme): boolean {
  if (preference === "system") return system === "dark";
  return preference === "dark";
}
