/**
 * Names the Android share-sheet action "Save to Bookmark AI".
 *
 * `expo-share-intent` attaches the ACTION_SEND intent filters to MainActivity,
 * which leaves the chooser falling back to the application label ("Bookmark
 * AI"). Android resolves a share target's label from the matched
 * `<intent-filter android:label>` FIRST (ResolveInfo.loadLabel → labelRes /
 * nonLocalizedLabel), then the activity, then the application — so the label
 * belongs on the intent filter. Putting it on MainActivity instead would also
 * rename the launcher icon, since the launcher reads the same activity label.
 *
 * Registered BEFORE "expo-share-intent" in app.json — deliberately. Expo runs
 * platform mods in REVERSE registration order (each `withAndroidManifest` wraps
 * the previously registered one and runs first), so listing this plugin earlier
 * is what makes it run LAST, once the filters exist. The throw below is the
 * guard against that ordering silently flipping.
 */
// `expo/config-plugins`, NOT `@expo/config-plugins`: the latter is a transitive
// dep that pnpm's strict isolation does not link into apps/mobile, so it only
// resolves inside Expo's own require graph. `expo prebuild` gets away with the
// bare specifier, but the RELEASE Gradle build loads this file from plain node
// processes (`:expo-constants:createExpoConfig`, `:app:createBundleReleaseJsAndAssets`)
// and dies with "Cannot find module '@expo/config-plugins'". The `expo/*`
// re-export resolves through the direct `expo` dependency, so it works everywhere.
const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

const SHARE_LABEL = "Save to Bookmark AI";
const SEND_ACTIONS = new Set([
  "android.intent.action.SEND",
  "android.intent.action.SEND_MULTIPLE",
]);

module.exports = function withAndroidShareLabel(config) {
  return withAndroidManifest(config, (config) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);
    const filters = activity["intent-filter"] ?? [];
    const labelled = filters.filter((filter) =>
      (filter.action ?? []).some((action) => SEND_ACTIONS.has(action?.$?.["android:name"])),
    );
    for (const filter of labelled) {
      filter.$ = { ...filter.$, "android:label": SHARE_LABEL };
    }
    if (labelled.length === 0) {
      throw new Error(
        "[withAndroidShareLabel] no ACTION_SEND intent filter on MainActivity — " +
          "is the expo-share-intent plugin still registered before this one?",
      );
    }
    return config;
  });
};
