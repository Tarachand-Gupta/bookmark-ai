/**
 * Real release signing for the Android build.
 *
 * Expo's generated `android/app/build.gradle` signs the `release` build type
 * with the DEBUG keystore (`signingConfig signingConfigs.debug` — the template
 * literally says "In production, you need to generate your own keystore"). A
 * debug-signed APK cannot be updated in place by a properly signed one, so it
 * must never be what users download.
 *
 * This plugin rewrites that block so `release` reads its keystore from the
 * environment / Gradle properties:
 *
 *   ANDROID_KEYSTORE_PATH      absolute path to the .keystore (PKCS12 or JKS)
 *   ANDROID_KEYSTORE_PASSWORD  store password
 *   ANDROID_KEY_ALIAS          key alias (ours: bookmark-ai)
 *   ANDROID_KEY_PASSWORD       key password
 *
 * When ANY of the four is unset the release build type falls back to the debug
 * keystore exactly as before, so `expo run:android --variant release` and dev
 * machines without the keystore keep working; the real keystore lives in the
 * repo-root `.keys/` (gitignored — see docs/features/releases.md) and in the
 * GitHub secrets of the same names for `.github/workflows/android-release.yml`.
 *
 * Idempotent: `expo prebuild` re-runs mods against the files on disk, so a
 * second run finds the marker and leaves the file alone. It throws if the
 * template block it expects is missing — a silent no-op here would ship a
 * debug-signed "release" again.
 */
// `expo/config-plugins`, not `@expo/config-plugins` — see withAndroidShareLabel.js
// for why (pnpm isolation vs. the release Gradle tasks that load this file).
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// [withReleaseSigning]";

const RELEASE_SIGNING_CONFIG = `
        release {
            ${MARKER} keystore from env / gradle properties; debug keystore when unset
            def rsPath = System.getenv("ANDROID_KEYSTORE_PATH") ?: findProperty("ANDROID_KEYSTORE_PATH")
            def rsStorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: findProperty("ANDROID_KEYSTORE_PASSWORD")
            def rsAlias = System.getenv("ANDROID_KEY_ALIAS") ?: findProperty("ANDROID_KEY_ALIAS")
            def rsKeyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: findProperty("ANDROID_KEY_PASSWORD")
            if (rsPath && rsStorePassword && rsAlias && rsKeyPassword) {
                if (!file(rsPath).exists()) {
                    throw new GradleException("ANDROID_KEYSTORE_PATH points to a missing file: " + rsPath)
                }
                storeFile file(rsPath)
                storePassword rsStorePassword
                keyAlias rsAlias
                keyPassword rsKeyPassword
                println("[withReleaseSigning] release signing: " + rsPath + " (alias " + rsAlias + ")")
            } else {
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
                println("[withReleaseSigning] WARNING: ANDROID_KEYSTORE_* unset - release build type is DEBUG-signed (dev only)")
            }
        }`;

function patchBuildGradle(contents) {
  if (contents.includes(MARKER)) return contents;

  // 1. Add a `release` signing config next to the template's `debug` one.
  const signingConfigs = /signingConfigs \{\s*\n(\s*)debug \{[\s\S]*?\n\1\}\n/;
  const sc = contents.match(signingConfigs);
  if (!sc) {
    throw new Error("[withReleaseSigning] android/app/build.gradle has no `signingConfigs { debug {…} }` block — template changed?");
  }
  contents = contents.replace(sc[0], sc[0] + RELEASE_SIGNING_CONFIG.replace(/^\n/, "") + "\n");

  // 2. Point the `release` build type at it. The template has exactly two
  //    `signingConfig signingConfigs.debug` lines: the first under `debug {`,
  //    the second under `release {`. Replace the one inside the release block.
  const releaseBlock = /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!releaseBlock.test(contents)) {
    throw new Error("[withReleaseSigning] release build type is not debug-signed in the template — refusing to guess.");
  }
  contents = contents.replace(releaseBlock, "$1signingConfig signingConfigs.release");
  return contents;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error("[withReleaseSigning] expected a Groovy build.gradle");
    }
    config.modResults.contents = patchBuildGradle(config.modResults.contents);
    return config;
  });
};
module.exports.patchBuildGradle = patchBuildGradle;
