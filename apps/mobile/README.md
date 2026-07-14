# @bookmark-ai/mobile — the iOS/iPad (and Android) app

Expo (React Native) app designed to feel **native iOS**, not a web page: bottom
floating tab bar (real Liquid Glass on iOS 26, frosted blur on iOS 18/Android), large
titles and the iOS type scale, SF Symbols, native bottom-sheet filters, day-grouped
lists, long-press action sheets, and haptics.

## Signing in

The app is Clerk-gated like the web app: Google SSO or an emailed one-time code. The
session token is stored in the iOS keychain (SecureStore) and attached to every API
request. **Settings → Server** switches between the open local dev API and the deployed
API at `bookmark-ai.cloud` (Next.js route handlers in `apps/web`, which verify the token
on every request).

## Layout

| Path | What |
| --- | --- |
| `App.tsx` | providers (Clerk → preferences → safe-area), auth gate, tab shell, deep links (`bookmarkai://tab/...`) |
| `src/api.ts` | API client — same contract as the web app; local/production server switch; bearer-token injection |
| `src/theme.ts` | design tokens — hex ports of `packages/ui/src/theme.css` (sync manually on retheme) |
| `src/navigation/TabBar.tsx` | floating glass tab bar + `useTabBarClearance()` (content scrolls under it) |
| `src/screens/` | Library (list/cards, quick filters), Search (keyword \| AI), Settings (account, theme, server), SignIn |
| `src/components/` | FilterSheet (native pageSheet), BookmarkRow/Card, SegmentedControl, Symbol (SF Symbol w/ Android fallback) |
| `src/hooks/` | `useLibrary` (filters + pagination + meta), `useSearch` (debounced) |
| `src/context/PreferencesContext.tsx` | theme/view/server persisted in AsyncStorage |
| `src/lib/` | Clerk keys + token cache, day grouping, long-press actions |

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

The iOS simulator reaches the local API at `localhost:4545`; the Android emulator sees
the host machine as `10.0.2.2` (handled in `src/api.ts`).

Dev-only env flags (bundle-time, ignored in release builds):

- `EXPO_PUBLIC_API_URL` — hard-override the API host
- `EXPO_PUBLIC_INITIAL_TAB=search|settings|filters` — open on a specific screen (headless screenshots)
- `EXPO_PUBLIC_SKIP_AUTH=1` — skip the sign-in gate against the open local server (QA agents)

See `AGENTS.md` here before writing code: Expo APIs change fast — check the versioned
docs for **SDK 57** specifically.
