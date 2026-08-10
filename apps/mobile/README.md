# @bookmark-ai/mobile — the iOS/iPad (and Android) app

Expo (React Native) app designed to feel **native iOS**, not a web page: bottom
floating tab bar (real Liquid Glass on iOS 26, frosted blur on iOS 18/Android), large
titles and the iOS type scale, SF Symbols, native bottom-sheet filters, day-grouped
lists, long-press action sheets, and haptics.

## Signing in

The app is Clerk-gated like the web app: Google SSO or an emailed one-time code. The
session token is stored in the iOS keychain (SecureStore) and attached to every API
request, which the Next.js route handlers in `apps/web` verify.

### Server target (build-time, not an in-app switch)

There is **no in-app server switch** — which API the build talks to is decided once at
bundle time by `resolveServerTarget()` in `src/api.ts`:

1. `EXPO_PUBLIC_SERVER_TARGET=local|production` — explicit override, wins.
2. else `__DEV__` — a dev run (`expo start` / `expo run:*`) → `local`, a release build
   (`eas build`) → `production`.

`local` means the Next dev server (`localhost:3000`, `10.0.2.2:3000` on the Android
emulator); `production` means `https://bookmark-ai.cloud`. To point a dev run at prod:

```bash
EXPO_PUBLIC_SERVER_TARGET=production npx expo run:ios
```

`EXPO_PUBLIC_API_URL` (and `EXPO_PUBLIC_LIVE_API_URL` for the live server) hard-override
the resolved host in any build. Settings shows the target read-only.

### Clerk instance

The publishable key **follows the server target** (`src/lib/clerk.ts`) so a session is
never sent to the other environment's API — no manual pairing needed:

| Server target | Clerk instance | Publishable key |
| --- | --- | --- |
| `production` | `clerk.bookmark-ai.cloud` | `pk_live_Y2xlcmsuYm9va21hcmstYWkuY2xvdWQk` |
| `local` | dev (`darling-baboon-13.accounts.dev`) | `pk_test_ZGFybGluZy1iYWJvb24tMTMuY2xlcmsuYWNjb3VudHMuZGV2JA` |

`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` overrides it (escape hatch for a throwaway/staging
instance). `EXPO_PUBLIC_*` values are inlined at bundle time, so **rebuild** after
changing any of them.

## "Save to Bookmark AI" (system share sheet)

Any app that can share a link can save to Bookmark AI — Chrome/Safari, chat apps,
anything that emits `ACTION_SEND text/*` (Android) or a web URL/page (iOS).

Native plumbing: the `expo-share-intent` plugin block in `app.json` (iOS share-extension
target `ai.purecode.bookmarkai.ShareExtension`, Android `ACTION_SEND` filters on
MainActivity) plus `plugins/withAndroidShareLabel.js`, which puts
`android:label="Save to Bookmark AI"` on the SEND intent filter — Android resolves a share
target's name from the filter first, so this names the action **without** renaming the
launcher icon. On iOS the extension's `CFBundleDisplayName` is `Save to Bookmark AI`; iOS
26's share sheet labels the row with the containing app's name (`Bookmark AI`) regardless.

JS side is `src/lib/share-intent.ts`: extract the first URL from the shared text (it is
prose as often as a bare link), auto-save it via `createBookmark`, confirm in
`ShareSavedBanner` (the scraped title replaces the raw link when the refetch lands). A
failed save opens the Add Bookmark sheet prefilled instead of losing the link; a share that
arrives while signed out is held in memory (never persisted) and completes right after
sign-in.

Both native folders are generated, so after touching any of this: `npx expo prebuild
--clean` and rebuild both apps.

## Layout

| Path | What |
| --- | --- |
| `App.tsx` | providers (share-intent → Clerk → preferences → safe-area), auth gate, tab shell, deep links (`bookmarkai://tab/...`), share-sheet save + confirmation banner |
| `plugins/withAndroidShareLabel.js` | local config plugin: names the Android share-sheet action "Save to Bookmark AI" |
| `src/api.ts` | API client — same contract as the web app; build-time server target (`SERVER_TARGET`: dev run → local, release → prod); bearer-token injection |
| `src/theme.ts` | design tokens — hex ports of `packages/ui/src/theme.css` (sync manually on retheme) |
| `src/navigation/TabBar.tsx` | floating glass tab bar + `useTabBarClearance()` (content scrolls under it) |
| `src/screens/` | Library (list/cards, quick filters), Search (keyword \| AI), Settings (account, theme; read-only server), SignIn (email+password, email code, forgot-password; Google on dev) |
| `src/components/` | FilterSheet (native pageSheet), BookmarkRow/Card, SegmentedControl, Symbol (SF Symbol w/ Android fallback) |
| `src/hooks/` | `useLibrary` (filters + pagination + meta), `useSearch` (debounced) |
| `src/context/PreferencesContext.tsx` | theme/view persisted in AsyncStorage (server target is a read-only build constant) |
| `src/lib/` | Clerk keys + token cache, day grouping, long-press actions, share-intent capture/URL parsing/auto-save |

The `ios/` and `android/` directories are **generated** (`expo prebuild`, gitignored) —
never edit them; change `app.json` instead.

## Run it

```bash
# iOS (needs Xcode + its iOS platform download)
npx expo run:ios          # build + install on the simulator
npx expo start            # Metro bundler (separate terminal)

# Android (needs JDK 21 + Android SDK; emulator or device)
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
npx expo run:android
```

The iOS simulator reaches the local API (the web dev server) at `localhost:3000`; the
Android emulator sees the host machine as `10.0.2.2` (handled in `src/api.ts`).

Other bundle-time env flags (see "Server target" above for `EXPO_PUBLIC_SERVER_TARGET` /
`EXPO_PUBLIC_API_URL`):

- `EXPO_PUBLIC_INITIAL_TAB=sessions|search|settings|filters` — open on a specific screen (headless screenshots)
- `EXPO_PUBLIC_SKIP_AUTH=1` — skip the sign-in gate against the open local server (QA agents); `__DEV__`-only, ignored in release builds

See `AGENTS.md` here before writing code: Expo APIs change fast — check the versioned
docs for **SDK 57** specifically.
