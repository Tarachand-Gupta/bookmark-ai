#!/usr/bin/env bash
#
# safari-xcode.sh — the ONE scripted path from the WXT Safari build to an Xcode
# project that archives for the Mac App Store (and, locally, to a signed Debug
# build installed in /Applications for Safari).
#
#   pnpm --filter @bookmark-ai/extension safari:xcode                       # steps 1-6
#   pnpm --filter @bookmark-ai/extension safari:xcode -- --build --install  # + Debug build → /Applications
#   pnpm --filter @bookmark-ai/extension safari:xcode -- --archive          # + Release .xcarchive (signed)
#   pnpm --filter @bookmark-ai/extension safari:xcode -- --archive --unsigned  # compile proof without a team
#
# Steps:
#   1. `pnpm build:safari`            → .output/safari-mv3 (skip with --skip-web-build)
#   2. bundle check                   → manifest version == package.json, prod-only host_permissions
#   3. safari-version.mjs --write     → safari-app/Version.xcconfig (MARKETING_VERSION / CURRENT_PROJECT_VERSION)
#   4. rsync                          → safari-app/Extension/Resources (gitignored staging dir)
#   5. drift guard                    → every top-level entry is listed in project.yml
#   6. xcodegen generate              → safari-app/BookmarkAISafari.xcodeproj (gitignored)
#   7. --build    xcodebuild Debug, signed with the "Apple Development" identity in the keychain
#                 (manual signing so no Xcode account/session is needed; ad-hoc if none)
#   8. --archive  xcodebuild archive, Release → safari-app/build/BookmarkAISafari.xcarchive
#   9. --install  quit the running app, ditto the Debug product over /Applications/Bookmark AI.app
#                 (keeps it the ONLY registered copy), relaunch, print pluginkit row + extension state
#
# Never calls `xcrun safari-web-extension-converter` — safari-app/project.yml replaced it.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"                 # apps/extension
APP_DIR="$EXT_DIR/safari-app"
BUNDLE_SRC="$EXT_DIR/.output/safari-mv3"
RES_DIR="$APP_DIR/Extension/Resources"
PROJECT="$APP_DIR/BookmarkAISafari.xcodeproj"
SCHEME="BookmarkAI"
DERIVED="$APP_DIR/DerivedData"
BUILD_DIR="$APP_DIR/build"
ARCHIVE="$BUILD_DIR/BookmarkAISafari.xcarchive"
APP_NAME="Bookmark AI"
APPEX_NAME="Bookmark AI Extension.appex"
APP_BUNDLE_ID="ai.bookmark.safari"
EXT_BUNDLE_ID="ai.bookmark.safari.Extension"
DEVELOPMENT_TEAM_ID="L3PP7DQZWS"   # = project.yml DEVELOPMENT_TEAM; prefixes the App Group
INSTALL_DEST="/Applications/$APP_NAME.app"

SKIP_WEB_BUILD=0; ALLOW_DEV=0; DO_BUILD=0; DO_ARCHIVE=0; UNSIGNED=0; DO_INSTALL=0; DO_OPEN=0
for arg in "$@"; do
  case "$arg" in
    --skip-web-build) SKIP_WEB_BUILD=1 ;;
    --allow-dev-bundle) ALLOW_DEV=1 ;;
    --build) DO_BUILD=1 ;;
    --archive) DO_ARCHIVE=1 ;;
    --unsigned) UNSIGNED=1 ;;
    --install) DO_INSTALL=1; DO_BUILD=1 ;;
    --open) DO_OPEN=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg (see --help)" >&2; exit 2 ;;
  esac
done

log() { printf '\n\033[1m[safari-xcode] %s\033[0m\n' "$*"; }

# ── 1. WXT production build ──────────────────────────────────────────────────
if [[ $SKIP_WEB_BUILD -eq 0 ]]; then
  log "1/6 pnpm build:safari"
  (cd "$EXT_DIR" && pnpm build:safari)
else
  log "1/6 skipping build:safari (reusing $BUNDLE_SRC)"
fi
[[ -f "$BUNDLE_SRC/manifest.json" ]] || { echo "ERROR: $BUNDLE_SRC/manifest.json missing — run without --skip-web-build" >&2; exit 1; }

# ── 2. Bundle check: version + prod-only origins ─────────────────────────────
log "2/6 checking the bundle"
node - "$EXT_DIR" "$BUNDLE_SRC" "$ALLOW_DEV" <<'NODE'
const [extDir, bundleDir, allowDev] = process.argv.slice(2);
const { readFileSync } = require("node:fs");
const pkg = JSON.parse(readFileSync(`${extDir}/package.json`, "utf8"));
const manifest = JSON.parse(readFileSync(`${bundleDir}/manifest.json`, "utf8"));
const PROD = ["https://bookmark-ai.cloud/*", "https://www.bookmark-ai.cloud/*", "https://clerk.bookmark-ai.cloud/*", "https://live.bookmark-ai.cloud/*"];
const fail = (m) => { console.error(`ERROR: ${m}`); process.exit(1); };
if (manifest.manifest_version !== 3) fail(`manifest_version is ${manifest.manifest_version}; Safari 26 needs MV3 (build:safari uses --mv3)`);
if (manifest.version !== pkg.version) fail(`manifest version ${manifest.version} != package.json ${pkg.version} — stale .output? rebuild`);
const hosts = [...(manifest.host_permissions ?? [])].sort();
const prod = [...PROD].sort();
const isProd = JSON.stringify(hosts) === JSON.stringify(prod) && manifest.name === "Bookmark AI";
if (!isProd && allowDev !== "1") fail(`not a production bundle (name=${JSON.stringify(manifest.name)}, hosts=${JSON.stringify(hosts)}) — pass --allow-dev-bundle to embed a dev/local build on purpose`);
console.log(`  manifest ${manifest.version} · ${manifest.name} · ${isProd ? "PROD origins" : "DEV origins (allowed by flag)"} · service worker ${manifest.background?.service_worker}`);
NODE

# ── 3. Versions ──────────────────────────────────────────────────────────────
log "3/6 syncing Version.xcconfig from package.json"
node "$SCRIPT_DIR/safari-version.mjs" --write

# ── 4. Stage the web-extension bundle ────────────────────────────────────────
log "4/6 rsync $BUNDLE_SRC → safari-app/Extension/Resources"
mkdir -p "$RES_DIR"
# icon-dev/ and icon-local/ are the other build targets' toolbar plates (WXT
# copies all of public/); the prod manifest never references them, so they stay
# out of the store bundle.
rsync -a --delete --exclude 'icon-dev/' --exclude 'icon-local/' --exclude '.DS_Store' "$BUNDLE_SRC/" "$RES_DIR/"
du -sh "$RES_DIR" | sed 's/^/  /'

# ── 5. Drift guard ───────────────────────────────────────────────────────────
log "5/6 drift guard (project.yml lists every top-level entry)"
missing=0
for entry in "$RES_DIR"/*; do
  name="$(basename "$entry")"
  if ! grep -q "Extension/Resources/$name\b" "$APP_DIR/project.yml"; then
    echo "  ERROR: $name is in the WXT output but not in safari-app/project.yml → add it under BookmarkAIExtension.sources" >&2
    missing=1
  fi
done
[[ $missing -eq 0 ]] || exit 1
echo "  ok: $(ls "$RES_DIR" | tr '\n' ' ')"

# ── 6. Generate the Xcode project ────────────────────────────────────────────
log "6/6 xcodegen generate → $PROJECT"
command -v xcodegen >/dev/null || { echo "ERROR: xcodegen not installed (brew install xcodegen)" >&2; exit 1; }
(cd "$APP_DIR" && xcodegen generate --quiet)
echo "  $(xcodebuild -project "$PROJECT" -showBuildSettings -scheme "$SCHEME" 2>/dev/null | grep -E '^\s+(MARKETING_VERSION|CURRENT_PROJECT_VERSION|PRODUCT_BUNDLE_IDENTIFIER|MACOSX_DEPLOYMENT_TARGET) ' | sed 's/^ *//' | tr '\n' ' ')"

[[ $DO_OPEN -eq 1 ]] && open "$PROJECT"

# ── Signing flags for local (non-App-Store) builds ───────────────────────────
# The project is Automatic-signing with Tara's team for Xcode/archive. For a
# scripted Debug build we don't want xcodebuild talking to the developer portal,
# so sign MANUALLY with the "Apple Development" identity already in the keychain
# (a real signature is what makes Safari keep the extension across restarts);
# fall back to ad-hoc when there is none (Safari then needs "Allow Unsigned
# Extensions" after every restart).
SIGN=()
local_sign_flags() {
  # (sets the SIGN array — macOS ships bash 3.2, which has no `mapfile`)
  local identity
  identity="$(security find-identity -v -p codesigning 2>/dev/null | grep -o '"Apple Development: [^"]*"' | head -1 | tr -d '"')"
  if [[ -n "$identity" ]]; then
    echo "  signing with: $identity"
    SIGN=(CODE_SIGN_STYLE=Manual "CODE_SIGN_IDENTITY=$identity" PROVISIONING_PROFILE_SPECIFIER=)
  else
    echo "  no Apple Development identity in the keychain — ad-hoc signing (Safari will treat the extension as unsigned)"
    SIGN=(CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- PROVISIONING_PROFILE_SPECIFIER=)
  fi
}

# ── 7. Debug build ───────────────────────────────────────────────────────────
if [[ $DO_BUILD -eq 1 ]]; then
  log "xcodebuild Debug build"
  local_sign_flags
  xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug -derivedDataPath "$DERIVED" \
    clean build "${SIGN[@]}" -quiet
  PRODUCT="$DERIVED/Build/Products/Debug/$APP_NAME.app"
  echo "  built: $PRODUCT"
  codesign -dv --entitlements - "$PRODUCT" 2>&1 | grep -E 'Identifier=|TeamIdentifier=|app-sandbox' | sed 's/^/  /'
fi

# ── 8. Release archive ───────────────────────────────────────────────────────
if [[ $DO_ARCHIVE -eq 1 ]]; then
  log "xcodebuild archive (Release) → $ARCHIVE"
  mkdir -p "$BUILD_DIR"; rm -rf "$ARCHIVE"
  EXTRA=()
  if [[ $UNSIGNED -eq 1 ]]; then
    echo "  --unsigned: CODE_SIGNING_ALLOWED=NO (compile proof only — not uploadable)"
    EXTRA=(CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO)
  fi
  xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Release -derivedDataPath "$DERIVED" \
    -archivePath "$ARCHIVE" archive "${EXTRA[@]}" -quiet
  echo "  archived: $ARCHIVE"
  /usr/libexec/PlistBuddy -c 'Print :ApplicationProperties' "$ARCHIVE/Info.plist" 2>/dev/null | sed 's/^/  /' || true
  if [[ $UNSIGNED -eq 0 ]]; then
    cat <<EOF

  Upload to App Store Connect (needs the paid team's distribution certificate — Xcode issues it):
    xcodebuild -exportArchive -archivePath "$ARCHIVE" \\
      -exportOptionsPlist "$APP_DIR/ExportOptions.plist" -exportPath "$BUILD_DIR/export" -allowProvisioningUpdates
  then upload build/export/*.pkg with Transporter, or Xcode ▸ Window ▸ Organizer ▸ Distribute App.
EOF
  fi
fi

# ── 9. Install for Safari ────────────────────────────────────────────────────
if [[ $DO_INSTALL -eq 1 ]]; then
  log "installing → $INSTALL_DEST (the only registered copy)"
  PRODUCT="$DERIVED/Build/Products/Debug/$APP_NAME.app"
  [[ -d "$PRODUCT" ]] || { echo "ERROR: $PRODUCT not built" >&2; exit 1; }
  # Graceful quit of the running menu-bar app (never kill -9 it).
  if pgrep -f "$INSTALL_DEST/Contents/MacOS/$APP_NAME" >/dev/null 2>&1; then
    osascript -e "tell application id \"$APP_BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
    for _ in $(seq 1 30); do
      pgrep -f "$INSTALL_DEST/Contents/MacOS/$APP_NAME" >/dev/null 2>&1 || break
      sleep 0.5
    done
  fi
  rm -rf "$INSTALL_DEST"
  ditto "$PRODUCT" "$INSTALL_DEST"
  # Unregister the DerivedData copy and delete it so LaunchServices/pluginkit see ONE app.
  pluginkit -r "$PRODUCT/Contents/PlugIns/$APPEX_NAME" >/dev/null 2>&1 || true
  rm -rf "$PRODUCT"
  pluginkit -a "$INSTALL_DEST/Contents/PlugIns/$APPEX_NAME" >/dev/null 2>&1 || true
  # The app mirrors Safari's answer into its (sandboxed) defaults on every
  # refresh; clear the previous value so we only accept a fresh one.
  STATE_KEY="$APP_BUNDLE_ID.lastExtensionState"
  defaults delete "$APP_BUNDLE_ID" "$STATE_KEY" >/dev/null 2>&1 || true
  open "$INSTALL_DEST"
  sleep 2
  echo "  pluginkit:"
  pluginkit -mAvvv -p com.apple.Safari.web-extension 2>/dev/null | grep -A3 "$EXT_BUNDLE_ID" | sed 's/^/    /' || echo "    (not registered yet — Safari registers on first launch; re-run pluginkit -mAvvv -p com.apple.Safari.web-extension)"
  state=unknown
  for _ in $(seq 1 15); do
    state="$(defaults read "$APP_BUNDLE_ID" "$STATE_KEY" 2>/dev/null || echo unknown)"
    [[ "$state" != "unknown" ]] && break
    sleep 1
  done
  echo "  Safari reports the extension: $state   (defaults read $APP_BUNDLE_ID $STATE_KEY)"
  [[ "$state" == "enabled" ]] || echo "  ⚠ not enabled — Safari ▸ Settings ▸ Extensions ▸ tick Bookmark AI (the app's menu-bar item opens that pane)"
  # The extension reports its sign-in state to the appex over nativeMessaging;
  # the appex stores it in the App Group suite (Shared/AuthStateStore.swift).
  GROUP_ID="$DEVELOPMENT_TEAM_ID.$APP_BUNDLE_ID"
  GROUP_PLIST="$HOME/Library/Group Containers/$GROUP_ID/Library/Preferences/$GROUP_ID.plist"
  if [[ -f "$GROUP_PLIST" ]]; then
    echo "  extension sign-in state (App Group $GROUP_ID):"
    (defaults read "$GROUP_PLIST" 2>/dev/null || plutil -p "$GROUP_PLIST") | sed 's/^/    /'
  else
    echo "  extension sign-in state: not reported yet — open the Safari popup once (the background sends it over nativeMessaging), then: defaults read \"$GROUP_PLIST\""
  fi
fi

log "done"
